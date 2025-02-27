import * as Sentry from '@sentry/node';
import * as Tracing from '@sentry/tracing';
import { SamplingContext } from '@sentry/types';
import bodyParser from 'body-parser';
import { LightdashMode, SessionUser } from 'common';
import apiSpec from 'common/dist/openapibundle.json';
import flash from 'connect-flash';
import connectSessionKnex from 'connect-session-knex';
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import expressSession from 'express-session';
import passport from 'passport';
import path from 'path';
import reDoc from 'redoc-express';
import { analytics } from './analytics/client';
import { LightdashAnalytics } from './analytics/LightdashAnalytics';
import { lightdashConfig } from './config/lightdashConfig';
import {
    googlePassportStrategy,
    localPassportStrategy,
} from './controllers/authentication';
import database from './database/database';
import { errorHandler } from './errors';
import Logger from './logger';
import { userModel } from './models/models';
import morganMiddleware from './morganMiddleware';
import { apiV1Router } from './routers/apiV1Router';
import { VERSION } from './version';

// @ts-ignore
// eslint-disable-next-line no-extend-native, func-names
BigInt.prototype.toJSON = function () {
    return this.toString();
};

process
    .on('unhandledRejection', (reason, p) => {
        Logger.error('Unhandled Rejection at Promise', reason, p);
    })
    .on('uncaughtException', (err) => {
        Logger.error('Uncaught Exception thrown', err);
        process.exit(1);
    });

const KnexSessionStore = connectSessionKnex(expressSession);

const store = new KnexSessionStore({
    knex: database as any,
    createtable: false,
    tablename: 'sessions',
    sidfieldname: 'sid',
});
const app = express();

const tracesSampler = (context: SamplingContext): boolean | number => {
    if (
        context.request?.url?.endsWith('/status') ||
        context.request?.url?.endsWith('/health')
    ) {
        return 0.0;
    }
    return 1.0;
};
Sentry.init({
    release: VERSION,
    dsn: process.env.SENTRY_DSN,
    environment:
        process.env.NODE_ENV === 'development'
            ? 'development'
            : lightdashConfig.mode,
    integrations: [
        new Sentry.Integrations.Http({ tracing: true }),
        new Tracing.Integrations.Express({
            app,
        }),
    ],
    tracesSampler,
});
app.use(
    Sentry.Handlers.requestHandler({
        user: ['userUuid', 'organizationUuid', 'organizationName'],
    }) as express.RequestHandler,
);
app.use(Sentry.Handlers.tracingHandler());
app.use(express.json());

// Logging
app.use(morganMiddleware);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
if (process.env.NODE_ENV === 'development') {
    app.use(
        OpenApiValidator.middleware({
            apiSpec: path.join(
                __dirname,
                '../../common/dist/openapibundle.json',
            ),
            // apiSpec,
            validateRequests: true,
            validateResponses: {
                removeAdditional: 'failing',
            },
            validateSecurity: false,
            validateApiSpec: true,
            operationHandlers: false,
            ignorePaths: (p: string) => !p.endsWith('invite-links'),
        }),
    );
}
app.use(
    expressSession({
        secret: lightdashConfig.lightdashSecret,
        proxy: lightdashConfig.trustProxy,
        cookie: {
            maxAge: 86400000, // 1 day
            secure: lightdashConfig.secureCookies,
            httpOnly: true,
            sameSite: 'lax',
        },
        resave: false,
        saveUninitialized: false,
        store,
    }),
);
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());
// api router
app.use('/api/v1', apiV1Router);

// Api docs
if (
    lightdashConfig.mode === LightdashMode.PR ||
    process.env.NODE_ENV !== 'production'
) {
    app.get('/api/docs/openapi.json', (req, res) => {
        res.send(apiSpec);
    });
    app.get(
        '/api/docs',
        reDoc({
            title: 'Lightdash API Docs',
            specUrl: '/api/docs/openapi.json',
        }),
    );
}

// frontend
app.use(express.static(path.join(__dirname, '../../frontend/build')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/build', 'index.html'));
});

// errors
app.use(Sentry.Handlers.errorHandler());
app.use((error: Error, req: Request, res: Response, _: NextFunction) => {
    const errorResponse = errorHandler(error);
    Logger.error(`Handled error on [${req.method}] ${req.path}`, errorResponse);
    analytics.track({
        event: 'api.error',
        organizationId: req.user?.organizationUuid,
        userId: req.user?.userUuid,
        anonymousId: !req.user?.userUuid
            ? LightdashAnalytics.anonymousId
            : undefined,
        properties: {
            name: errorResponse.name,
            statusCode: errorResponse.statusCode,
            route: req.path,
            method: req.method,
        },
    });
    res.status(errorResponse.statusCode).send({
        status: 'error',
        error: {
            statusCode: errorResponse.statusCode,
            name: errorResponse.name,
            message: errorResponse.message,
            data: errorResponse.data,
        },
    });
});

// Run the server
const port = process.env.PORT || 8080;
app.listen(port, () => {
    Logger.info(
        `\n   |     |     |     |     |     |     |\n   |     |     |     |     |     |     |\n   |     |     |     |     |     |     |  \n \\ | / \\ | / \\ | / \\ | / \\ | / \\ | / \\ | /\n  \\|/   \\|/   \\|/   \\|/   \\|/   \\|/   \\|/\n------------------------------------------\nLaunch lightdash at http://localhost:${port}\n------------------------------------------\n  /|\\   /|\\   /|\\   /|\\   /|\\   /|\\   /|\\\n / | \\ / | \\ / | \\ / | \\ / | \\ / | \\ / | \\\n   |     |     |     |     |     |     |\n   |     |     |     |     |     |     |\n   |     |     |     |     |     |     |`,
    );
});

// We need to override this interface to have our user typing
declare global {
    namespace Express {
        interface User extends SessionUser {}
    }
}

passport.use(localPassportStrategy);
if (googlePassportStrategy) {
    passport.use(googlePassportStrategy);
}
passport.serializeUser((user, done) => {
    // On login (user changes), user.userUuid is written to the session store in the `sess.passport.data` field
    done(null, user.userUuid);
});

// Before each request handler we read `sess.passport.user` from the session store
passport.deserializeUser(async (id: string, done) => {
    // Convert to a full user profile
    const user = await userModel.findSessionUserByUUID(id);
    // Store that user on the request (`req`) object
    done(null, user);
});
