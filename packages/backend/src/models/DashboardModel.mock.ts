import { CreateDashboard, DashboardTileTypes } from 'common';

export const createDashboardWithNoChart: CreateDashboard = {
    name: 'my new dashboard',
    tiles: [
        {
            type: DashboardTileTypes.SAVED_CHART,
            x: 4,
            y: 5,
            h: 100,
            w: 200,
            properties: {
                savedChartUuid: null,
            },
        },
    ],
};
