import { Knex } from 'knex';
import {
    AddDashboardVersion,
    CreateDashboard,
    Dashboard,
    DashboardBasicDetails,
    DashboardTileTypes,
    UpdateDashboard,
} from 'common';
import { NotFoundError } from '../errors';
import {
    DashboardsTableName,
    DashboardVersionsTableName,
    DashboardTilesTableName,
    DashboardTable,
    DashboardVersionTable,
    DashboardTileChartTableName,
} from '../database/entities/dashboards';
import { SavedQueriesTableName } from '../database/entities/savedQueries';
import { ProjectTableName } from '../database/entities/projects';
import { SpaceTableName } from '../database/entities/spaces';

type GetDashboardQuery = Pick<
    DashboardTable['base'],
    'dashboard_id' | 'dashboard_uuid' | 'name'
> &
    Pick<DashboardVersionTable['base'], 'dashboard_version_id' | 'created_at'>;

type DashboardModelDependencies = {
    database: Knex;
};

export class DashboardModel {
    private readonly database: Knex;

    constructor(deps: DashboardModelDependencies) {
        this.database = deps.database;
    }

    private static async getSpace(db: Knex, projectUuid: string) {
        const [space] = await db(SpaceTableName)
            .innerJoin(
                ProjectTableName,
                'projects.project_id',
                'spaces.project_id',
            )
            .where('project_uuid', projectUuid)
            .select('spaces.*')
            .limit(1);
        return space;
    }

    private static createVersion(
        db: Knex,
        dashboardId: number,
        version: AddDashboardVersion,
    ): Promise<void> {
        return db.transaction(async (trx) => {
            try {
                const [newVersionId] = await trx(DashboardVersionsTableName)
                    .insert({
                        dashboard_id: dashboardId,
                    })
                    .returning(['dashboard_version_id']);

                const promises: Promise<any>[] = [];
                version.tiles.forEach(
                    ({ type, w, h, x, y, properties }, index) => {
                        promises.push(
                            trx(DashboardTilesTableName).insert({
                                dashboard_version_id: newVersionId,
                                rank: index,
                                type,
                                height: h,
                                width: w,
                                x_offset: x,
                                y_offset: y,
                            }),
                        );
                        if (type === DashboardTileTypes.SAVED_CHART) {
                            promises.push(
                                db.transaction(async (innerTrx) => {
                                    try {
                                        const [savedChartId] = await innerTrx(
                                            SavedQueriesTableName,
                                        )
                                            .select(['saved_query_id'])
                                            .where(
                                                'saved_query_uuid',
                                                properties.savedChartUuid,
                                            )
                                            .limit(1);
                                        innerTrx(
                                            DashboardTileChartTableName,
                                        ).insert({
                                            dashboard_version_id: newVersionId,
                                            rank: index,
                                            saved_chart_id: savedChartId,
                                        });
                                    } catch (e) {
                                        await trx.rollback(e);
                                        throw e;
                                    }
                                }),
                            );
                        }
                    },
                );
                await Promise.all(promises);
            } catch (e) {
                await trx.rollback(e);
                throw e;
            }
        });
    }

    async getAllByProject(
        projectUuid: string,
    ): Promise<DashboardBasicDetails[]> {
        const space = await DashboardModel.getSpace(this.database, projectUuid);
        const dashboards = await this.database(DashboardsTableName)
            .select('dashboard_uuid', 'name', 'created_at')
            .where('space_id', space.space_id);
        return dashboards.map(({ name, dashboard_uuid, created_at }) => ({
            name,
            dashboardUuid: dashboard_uuid,
            createdAt: created_at,
        }));
    }

    async getById(dashboardUuid: string): Promise<Dashboard> {
        const results = await this.database(DashboardsTableName)
            .leftJoin(
                DashboardVersionsTableName,
                `${DashboardsTableName}.dashboard_id`,
                `${DashboardVersionsTableName}.dashboard_id`,
            )
            .select<GetDashboardQuery[]>([
                `${DashboardsTableName}.dashboard_id`,
                `${DashboardsTableName}.dashboard_uuid`,
                `${DashboardsTableName}.name`,
                `${DashboardVersionsTableName}.dashboard_version_id`,
                `${DashboardVersionsTableName}.created_at`,
            ])
            .where('dashboard_uuid', dashboardUuid)
            .orderBy(`${DashboardVersionsTableName}.created_at`, 'desc')
            .limit(1);
        if (results.length <= 0) {
            throw new NotFoundError('Dashboard not found');
        }
        const dashboard = results[0];

        const tiles = await this.database(DashboardTilesTableName)
            .select('*')
            .where('dashboard_version_id', dashboard.dashboard_version_id)
            .orderBy('rank', 'asc');

        const charts = await this.database(DashboardTileChartTableName)
            .leftJoin(
                SavedQueriesTableName,
                `${DashboardTileChartTableName}.saved_chart_id`,
                `${SavedQueriesTableName}.saved_chart_id`,
            )
            .select<Array<{ rank: number; saved_query_uuid: string }>>([
                `${DashboardTileChartTableName}.rank`,
                `${SavedQueriesTableName}.saved_query_uuid`,
            ])
            .where('dashboard_version_id', dashboard.dashboard_version_id)
            .orderBy('rank', 'asc');

        return {
            dashboardUuid: dashboard.dashboard_uuid,
            name: dashboard.name,
            createdAt: dashboard.created_at,
            tiles: tiles.map(
                ({ type, height, width, x_offset, y_offset, rank }) => ({
                    type,
                    properties: {
                        savedChartUuid:
                            charts.find((chart) => chart.rank === rank)
                                ?.saved_query_uuid || null,
                    },
                    x: x_offset,
                    y: y_offset,
                    h: height,
                    w: width,
                }),
            ),
        };
    }

    async create(
        projectUuid: string,
        dashboard: CreateDashboard,
    ): Promise<string> {
        return this.database.transaction(async (trx) => {
            try {
                const space = await DashboardModel.getSpace(trx, projectUuid);

                const [newDashboard] = await trx(DashboardsTableName)
                    .insert({
                        name: dashboard.name,
                        space_id: space.space_id,
                    })
                    .returning(['dashboard_id', 'dashboard_uuid']);

                await DashboardModel.createVersion(
                    trx,
                    newDashboard.dashboard_id,
                    dashboard,
                );

                return newDashboard.dashboard_uuid;
            } catch (e) {
                await trx.rollback(e);
                throw e;
            }
        });
    }

    async update(
        dashboardUuid: string,
        dashboard: UpdateDashboard,
    ): Promise<void> {
        await this.database(DashboardsTableName)
            .update(dashboard)
            .where('dashboard_uuid', dashboardUuid);
    }

    async delete(dashboardUuid: string): Promise<void> {
        await this.database(DashboardsTableName)
            .where('dashboard_uuid', dashboardUuid)
            .delete();
    }

    async addVersion(
        dashboardUuid: string,
        version: AddDashboardVersion,
    ): Promise<void> {
        const [dashboard] = await this.database(DashboardsTableName)
            .select(['dashboard_id'])
            .where('dashboard_uuid', dashboardUuid)
            .limit(1);
        await DashboardModel.createVersion(
            this.database,
            dashboard.dashboard_id,
            version,
        );
    }
}
