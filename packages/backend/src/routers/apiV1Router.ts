import express from 'express';
import passport from 'passport';
import { lightdashConfig } from '../config/lightdashConfig';
import {
    getGoogleLogin,
    getGoogleLoginFailure,
    getGoogleLoginSuccess,
    unauthorisedInDemo,
} from '../controllers/authentication';
import { userModel } from '../models/models';
import { UserModel } from '../models/UserModel';
import { healthService, userService } from '../services/services';
import { sanitizeEmailParam, sanitizeStringParam } from '../utils';
import { dashboardRouter } from './dashboardRouter';
import { inviteLinksRouter } from './inviteLinksRouter';
import { organizationRouter } from './organizationRouter';
import { passwordResetLinksRouter } from './passwordResetLinksRouter';
import { projectRouter } from './projectRouter';
import { savedChartRouter } from './savedChartRouter';
import { userRouter } from './userRouter';

export const apiV1Router = express.Router();

apiV1Router.get('/health', async (req, res, next) => {
    healthService
        .getHealthState(!!req.user?.userUuid)
        .then((state) =>
            res.json({
                status: 'ok',
                results: state,
            }),
        )
        .catch(next);
});

apiV1Router.get('/flash', (req, res) => {
    res.json({
        status: 'ok',
        results: req.flash(),
    });
});

apiV1Router.post('/register', unauthorisedInDemo, async (req, res, next) => {
    try {
        const lightdashUser = await userService.registerInitialUser({
            firstName: sanitizeStringParam(req.body.firstName),
            lastName: sanitizeStringParam(req.body.lastName),
            email: sanitizeEmailParam(req.body.email),
            password: sanitizeStringParam(req.body.password),
        });
        const sessionUser = await userModel.findSessionUserByUUID(
            lightdashUser.userUuid,
        );
        req.login(sessionUser, (err) => {
            if (err) {
                next(err);
            }
            res.json({
                status: 'ok',
                results: lightdashUser,
            });
        });
    } catch (e) {
        next(e);
    }
});

apiV1Router.post('/login', passport.authenticate('local'), (req, res, next) => {
    req.session.save((err) => {
        if (err) {
            next(err);
        } else {
            res.json({
                status: 'ok',
                results: UserModel.lightdashUserFromSession(req.user!),
            });
        }
    });
});

apiV1Router.get(
    lightdashConfig.auth.google.loginPath,
    getGoogleLogin,
    passport.authenticate('google', {
        scope: ['profile', 'email'],
    }),
);

apiV1Router.get(
    lightdashConfig.auth.google.callbackPath,
    passport.authenticate('google', {
        failureRedirect: '/api/v1/oauth/google/failure',
        successRedirect: '/api/v1/oauth/google/success',
        failureFlash: true,
    }),
);
apiV1Router.get('/oauth/google/failure', getGoogleLoginFailure);
apiV1Router.get('/oauth/google/success', getGoogleLoginSuccess);

apiV1Router.get('/logout', (req, res, next) => {
    req.logout();
    req.session.save((err) => {
        if (err) {
            next(err);
        } else {
            res.json({
                status: 'ok',
            });
        }
    });
});

apiV1Router.use('/saved', savedChartRouter);
apiV1Router.use('/invite-links', inviteLinksRouter);
apiV1Router.use('/org', organizationRouter);
apiV1Router.use('/user', userRouter);
apiV1Router.use('/projects/:projectUuid', projectRouter);
apiV1Router.use('/dashboards/:dashboardUuid', dashboardRouter);
apiV1Router.use('/password-reset', passwordResetLinksRouter);
