import knex from 'knex';
import { getTracker, MockClient, Tracker } from 'knex-mock-client';
import { LightdashMode } from 'common';
import { DashboardModel } from './DashboardModel';
import { SavedQueriesTableName } from '../database/entities/savedQueries';
import { createDashboardWithNoChart } from './DashboardModel.mock';
import {
    DashboardsTableName,
    DashboardTileChartTableName,
    DashboardTilesTableName,
    DashboardVersionsTableName,
} from '../database/entities/dashboards';
import { SpaceTableName } from '../database/entities/spaces';

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
process.env.DEBUG = 'knex:tx';
const database = knex({ client: MockClient, debug: true });

// Note: this doesn't work, created a ticket in their github: https://github.com/felixmosh/knex-mock-client/issues/5
describe.skip('DashboardModel', () => {
    let tracker: Tracker;
    beforeAll(() => {
        tracker = getTracker();
    });
    beforeEach(() => {
        tracker.on
            .select(SpaceTableName)
            .response([{ space_id: 'my_space_id' }]);
        tracker.on
            .select(SavedQueriesTableName)
            .response([{ space_id: 'my_saved_chart_id' }]);
    });
    afterEach(() => {
        tracker.reset();
    });
    test('should create dashboard', async () => {
        const insertId = 'my_dashboard_id';
        tracker.on.insert(DashboardsTableName).response([insertId]);
        tracker.on
            .insert(DashboardVersionsTableName)
            .response(['my_version_id']);
        tracker.on.insert(DashboardTilesTableName).response([]);
        tracker.on.insert(DashboardTileChartTableName).response([]);

        const model = new DashboardModel({ database });
        const dashboardUuid: string = await model.create(
            'my_project_uuid',
            createDashboardWithNoChart,
        );

        expect(dashboardUuid).toEqual(insertId);

        const insertHistory = tracker.history.insert;

        expect(insertHistory).toHaveLength(4);
    });
});
