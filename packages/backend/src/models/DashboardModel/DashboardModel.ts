import {
    CreateDashboard,
    Dashboard,
    DashboardBasicDetails,
    DashboardTileTypes,
    DashboardUnversionedFields,
    DashboardVersionedFields,
} from 'common';
import { Knex } from 'knex';
import {
    DashboardsTableName,
    DashboardTable,
    DashboardTileChartTable,
    DashboardTileChartTableName,
    DashboardTileLoomsTableName,
    DashboardTileMarkdownsTableName,
    DashboardTilesTableName,
    DashboardVersionsTableName,
    DashboardVersionTable,
} from '../../database/entities/dashboards';
import { ProjectTableName } from '../../database/entities/projects';
import {
    SavedQueriesTableName,
    SavedQueryTable,
} from '../../database/entities/savedQueries';
import { SpaceTableName } from '../../database/entities/spaces';
import { NotFoundError, UnexpectedServerError } from '../../errors';
import Transaction = Knex.Transaction;

export type GetDashboardQuery = Pick<
    DashboardTable['base'],
    'dashboard_id' | 'dashboard_uuid' | 'name' | 'description'
> &
    Pick<DashboardVersionTable['base'], 'dashboard_version_id' | 'created_at'>;
export type GetDashboardDetailsQuery = Pick<
    DashboardTable['base'],
    'dashboard_uuid' | 'name' | 'description'
> &
    Pick<DashboardVersionTable['base'], 'created_at'>;
export type GetChartTileQuery = Pick<
    DashboardTileChartTable['base'],
    'dashboard_tile_uuid'
> &
    Pick<SavedQueryTable['base'], 'saved_query_uuid'>;

type DashboardModelDependencies = {
    database: Knex;
};

export class DashboardModel {
    private readonly database: Knex;

    constructor(deps: DashboardModelDependencies) {
        this.database = deps.database;
    }

    private static async createVersion(
        trx: Transaction,
        dashboardId: number,
        version: DashboardVersionedFields,
    ): Promise<void> {
        const [versionId] = await trx(DashboardVersionsTableName).insert(
            {
                dashboard_id: dashboardId,
            },
            ['dashboard_version_id'],
        );

        const promises: Promise<any>[] = [];
        version.tiles.forEach((tile) => {
            const { uuid: dashboardTileId, type, w, h, x, y } = tile;
            promises.push(
                (async () => {
                    const [insertedTile] = await trx(DashboardTilesTableName)
                        .insert({
                            dashboard_version_id:
                                versionId.dashboard_version_id,
                            dashboard_tile_uuid: dashboardTileId,
                            type,
                            height: h,
                            width: w,
                            x_offset: x,
                            y_offset: y,
                        })
                        .returning('*');
                    switch (tile.type) {
                        case DashboardTileTypes.SAVED_CHART:
                            if (tile.properties.savedChartUuid) {
                                const [savedChart] = await trx(
                                    SavedQueriesTableName,
                                )
                                    .select(['saved_query_id'])
                                    .where(
                                        'saved_query_uuid',
                                        tile.properties.savedChartUuid,
                                    )
                                    .limit(1);
                                if (!savedChart) {
                                    throw new NotFoundError(
                                        'Saved chart not found',
                                    );
                                }
                                await trx(DashboardTileChartTableName).insert({
                                    dashboard_version_id:
                                        versionId.dashboard_version_id,
                                    dashboard_tile_uuid:
                                        insertedTile.dashboard_tile_uuid,
                                    saved_chart_id: savedChart.saved_query_id,
                                });
                            }
                            break;
                        case DashboardTileTypes.MARKDOWN:
                            await trx(DashboardTileMarkdownsTableName).insert({
                                dashboard_version_id:
                                    versionId.dashboard_version_id,
                                dashboard_tile_uuid:
                                    insertedTile.dashboard_tile_uuid,
                                title: tile.properties.title,
                                content: tile.properties.content,
                            });
                            break;
                        case DashboardTileTypes.LOOM:
                            await trx(DashboardTileLoomsTableName).insert({
                                dashboard_version_id:
                                    versionId.dashboard_version_id,
                                dashboard_tile_uuid:
                                    insertedTile.dashboard_tile_uuid,
                                title: tile.properties.title,
                                url: tile.properties.url,
                            });
                            break;
                        default: {
                            const never: never = tile;
                            throw new UnexpectedServerError(
                                `Dashboard tile type "${type}" not recognised`,
                            );
                        }
                    }
                })(),
            );
        });
        await Promise.all(promises);
    }

    async getAllByProject(
        projectUuid: string,
    ): Promise<DashboardBasicDetails[]> {
        const dashboards = await this.database(DashboardsTableName)
            .leftJoin(
                DashboardVersionsTableName,
                `${DashboardsTableName}.dashboard_id`,
                `${DashboardVersionsTableName}.dashboard_id`,
            )
            .leftJoin(
                SpaceTableName,
                `${DashboardsTableName}.space_id`,
                `${SpaceTableName}.space_id`,
            )
            .innerJoin(
                ProjectTableName,
                `${SpaceTableName}.project_id`,
                `${ProjectTableName}.project_id`,
            )
            .select<GetDashboardDetailsQuery[]>([
                `${DashboardsTableName}.dashboard_uuid`,
                `${DashboardsTableName}.name`,
                `${DashboardsTableName}.description`,
                `${DashboardVersionsTableName}.created_at`,
            ])
            .orderBy([
                {
                    column: `${DashboardVersionsTableName}.dashboard_id`,
                },
                {
                    column: `${DashboardVersionsTableName}.created_at`,
                    order: 'desc',
                },
            ])
            .distinctOn(`${DashboardVersionsTableName}.dashboard_id`)
            .where('project_uuid', projectUuid);
        return dashboards.map(
            ({ name, description, dashboard_uuid, created_at }) => ({
                name,
                description,
                uuid: dashboard_uuid,
                updatedAt: created_at,
            }),
        );
    }

    async getById(dashboardUuid: string): Promise<Dashboard> {
        const [dashboard] = await this.database(DashboardsTableName)
            .leftJoin(
                DashboardVersionsTableName,
                `${DashboardsTableName}.dashboard_id`,
                `${DashboardVersionsTableName}.dashboard_id`,
            )
            .select<GetDashboardQuery[]>([
                `${DashboardsTableName}.dashboard_id`,
                `${DashboardsTableName}.dashboard_uuid`,
                `${DashboardsTableName}.name`,
                `${DashboardsTableName}.description`,
                `${DashboardVersionsTableName}.dashboard_version_id`,
                `${DashboardVersionsTableName}.created_at`,
            ])
            .where('dashboard_uuid', dashboardUuid)
            .orderBy(`${DashboardVersionsTableName}.created_at`, 'desc')
            .limit(1);
        if (!dashboard) {
            throw new NotFoundError('Dashboard not found');
        }

        const tiles = await this.database(DashboardTilesTableName)
            .select<
                {
                    x_offset: number;
                    y_offset: number;
                    type: DashboardTileTypes;
                    width: number;
                    height: number;
                    dashboard_tile_uuid: string;
                    saved_query_uuid: string | null;
                    loomTitle: string | null;
                    url: string | null;
                    markdownTitle: string | null;
                    content: string | null;
                }[]
            >([
                `${DashboardTilesTableName}.x_offset`,
                `${DashboardTilesTableName}.y_offset`,
                `${DashboardTilesTableName}.type`,
                `${DashboardTilesTableName}.width`,
                `${DashboardTilesTableName}.height`,
                `${DashboardTilesTableName}.dashboard_tile_uuid`,
                `${SavedQueriesTableName}.saved_query_uuid`,
                `${DashboardTileLoomsTableName}.title as loomTitle`,
                `${DashboardTileLoomsTableName}.url`,
                `${DashboardTileMarkdownsTableName}.title as markdownTitle`,
                `${DashboardTileMarkdownsTableName}.content`,
            ])
            .leftJoin(DashboardTileChartTableName, function chartsJoin() {
                this.on(
                    `${DashboardTileChartTableName}.dashboard_tile_uuid`,
                    '=',
                    `${DashboardTilesTableName}.dashboard_tile_uuid`,
                );
                this.andOn(
                    `${DashboardTileChartTableName}.dashboard_version_id`,
                    '=',
                    `${DashboardTilesTableName}.dashboard_version_id`,
                );
            })
            .leftJoin(DashboardTileLoomsTableName, function loomsJoin() {
                this.on(
                    `${DashboardTileLoomsTableName}.dashboard_tile_uuid`,
                    '=',
                    `${DashboardTilesTableName}.dashboard_tile_uuid`,
                );
                this.andOn(
                    `${DashboardTileLoomsTableName}.dashboard_version_id`,
                    '=',
                    `${DashboardTilesTableName}.dashboard_version_id`,
                );
            })
            .leftJoin(DashboardTileMarkdownsTableName, function markdownJoin() {
                this.on(
                    `${DashboardTileMarkdownsTableName}.dashboard_tile_uuid`,
                    '=',
                    `${DashboardTilesTableName}.dashboard_tile_uuid`,
                );
                this.andOn(
                    `${DashboardTileMarkdownsTableName}.dashboard_version_id`,
                    '=',
                    `${DashboardTilesTableName}.dashboard_version_id`,
                );
            })
            .leftJoin(
                SavedQueriesTableName,
                `${DashboardTileChartTableName}.saved_chart_id`,
                `${SavedQueriesTableName}.saved_query_id`,
            )
            .where(
                `${DashboardTilesTableName}.dashboard_version_id`,
                dashboard.dashboard_version_id,
            );

        return {
            uuid: dashboard.dashboard_uuid,
            name: dashboard.name,
            description: dashboard.description,
            updatedAt: dashboard.created_at,
            tiles: tiles.map(
                ({
                    type,
                    height,
                    width,
                    x_offset,
                    y_offset,
                    dashboard_tile_uuid,
                    saved_query_uuid,
                    loomTitle,
                    url,
                    markdownTitle,
                    content,
                }) => {
                    const base: Omit<
                        Dashboard['tiles'][number],
                        'type' | 'properties'
                    > = {
                        uuid: dashboard_tile_uuid,
                        x: x_offset,
                        y: y_offset,
                        h: height,
                        w: width,
                    };

                    switch (type) {
                        case DashboardTileTypes.SAVED_CHART:
                            return {
                                ...base,
                                type: DashboardTileTypes.SAVED_CHART,
                                properties: {
                                    savedChartUuid: saved_query_uuid,
                                },
                            };
                        case DashboardTileTypes.MARKDOWN:
                            return {
                                ...base,
                                type: DashboardTileTypes.MARKDOWN,
                                properties: {
                                    title: markdownTitle || '',
                                    content: content || '',
                                },
                            };
                        case DashboardTileTypes.LOOM:
                            return {
                                ...base,
                                type: DashboardTileTypes.LOOM,
                                properties: {
                                    title: loomTitle || '',
                                    url: url || '',
                                },
                            };
                        default: {
                            const never: never = type;
                            throw new UnexpectedServerError(
                                `Dashboard tile type "${type}" not recognised`,
                            );
                        }
                    }
                },
            ),
        };
    }

    async create(
        spaceUuid: string,
        dashboard: CreateDashboard,
    ): Promise<string> {
        return this.database.transaction(async (trx) => {
            const [space] = await trx(SpaceTableName)
                .where('space_uuid', spaceUuid)
                .select('spaces.*')
                .limit(1);
            if (!space) {
                throw new NotFoundError('Space not found');
            }
            const [newDashboard] = await trx(DashboardsTableName)
                .insert({
                    name: dashboard.name,
                    description: dashboard.description,
                    space_id: space.space_id,
                })
                .returning(['dashboard_id', 'dashboard_uuid']);

            await DashboardModel.createVersion(
                trx,
                newDashboard.dashboard_id,
                dashboard,
            );

            return newDashboard.dashboard_uuid;
        });
    }

    async update(
        dashboardUuid: string,
        dashboard: DashboardUnversionedFields,
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
        version: DashboardVersionedFields,
    ): Promise<void> {
        const [dashboard] = await this.database(DashboardsTableName)
            .select(['dashboard_id'])
            .where('dashboard_uuid', dashboardUuid)
            .limit(1);
        if (!dashboard) {
            throw new NotFoundError('Dashboard not found');
        }
        return this.database.transaction(async (trx) => {
            await DashboardModel.createVersion(
                trx,
                dashboard.dashboard_id,
                version,
            );
        });
    }
}
