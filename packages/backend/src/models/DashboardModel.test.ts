import knex from 'knex';
import mockDb from 'mock-knex';
import { LightdashMode } from 'common';
import { DashboardModel } from './DashboardModel';
import { ProjectTableName } from '../database/entities/projects';
import { SavedQueriesTableName } from '../database/entities/savedQueries';
import { createDashboardWithNoChart } from './DashboardModel.mock';

jest.mock('../config/lightdashConfig', () => ({
    lightdashConfig: {
        mode: LightdashMode.DEFAULT,
        projects: [
            {
                name: 'default',
                type: 'dbt',
                profiles_dir: '/',
                project_dir: '/',
            },
        ],
    },
}));

const database = knex({
    client: 'pg',
    migrations: {
        directory: './src/database/migrations',
        tableName: 'knex_migrations',
        extension: 'ts',
        loadExtensions: ['.ts'],
    },
    seeds: {
        directory: './src/database/seeds/development',
        extension: 'ts',
        loadExtensions: ['.ts'],
    },
    debug: true,
});

// Note: this doesn't work, created a ticket in their github: https://github.com/jbrumwell/mock-knex/issues/130
describe.skip('DashboardModel', () => {
    let projectUuid: string;
    let savedQueryUuid: string;
    beforeAll(async () => {
        mockDb.mock(database);
        await database.migrate.rollback();
        await database.migrate.latest();
        await database.seed.run();
        [projectUuid] = await database(ProjectTableName).select('project_uuid');
        [savedQueryUuid] = await database(SavedQueriesTableName).select(
            'saved_query_uuid',
        );
    });
    afterAll(() => {
        mockDb.unmock(database);
    });
    test('should create dashboard', async () => {
        const model = new DashboardModel({ database });
        const dashboardUuid: string = await model.create(
            projectUuid,
            createDashboardWithNoChart,
        );
        const dashboard = await model.getById(dashboardUuid);
        expect(dashboard).toEqual(
            expect.objectContaining({
                ...createDashboardWithNoChart,
            }),
        );
    });
});
