import {
    CreateSavedQuery,
    CreateSavedQueryVersion,
    DBChartTypes,
    DBFieldTypes,
    example,
    SavedQuery,
    SortField,
    UpdateSavedQuery,
} from 'common';
import { Knex } from 'knex';
import { NotFoundError } from '../../errors';
import database from '../database';
import { getSpace } from './spaces';

export const SavedQueriesTableName = 'saved_queries';
export const SavedQueriesVersionsTableName = 'saved_queries_versions';

type DbSavedQueryDetails = {
    saved_query_id: number;
    saved_query_uuid: string;
    name: string;
    saved_queries_version_id: number;
    explore_name: string;
    filters: any;
    row_limit: number;
    x_dimension: string | undefined;
    group_dimension: string | undefined;
    chart_type: DBChartTypes;
    created_at: Date;
};

type DbSavedQuery = {
    saved_query_id: number;
    saved_query_uuid: string;
    space_id: number;
    name: string;
    created_at: Date;
};

export type SavedQueryTable = Knex.CompositeTableType<
    DbSavedQuery,
    Pick<DbSavedQuery, 'name' | 'space_id'>,
    Pick<DbSavedQuery, 'name'>
>;

type DbSavedQueryVersion = {
    saved_queries_version_id: number;
    saved_queries_version_uuid: string;
    explore_name: string;
    row_limit: number;
    filters: any;
    chart_type: DBChartTypes;
    x_dimension: string | undefined;
    group_dimension: string | undefined;
    created_at: Date;
    saved_query_id: number;
};

type CreateDbSavedQueryVersion = Pick<
    DbSavedQueryVersion,
    | 'saved_query_id'
    | 'explore_name'
    | 'filters'
    | 'row_limit'
    | 'group_dimension'
    | 'x_dimension'
    | 'chart_type'
>;

type DbSavedQueryVersionYMetric = {
    saved_queries_version_y_metric_id: number;
    saved_queries_version_id: number;
    field_name: string;
    order: number;
};

type CreateDbSavedQueryVersionYMetric = Pick<
    DbSavedQueryVersionYMetric,
    'field_name' | 'saved_queries_version_id' | 'order'
>;

type DbSavedQueryVersionField = {
    saved_queries_version_field_id: number;
    saved_queries_version_id: number;
    name: string;
    field_type: DBFieldTypes;
    order: number;
};

type CreateDbSavedQueryVersionField = Pick<
    DbSavedQueryVersionField,
    'saved_queries_version_id' | 'name' | 'field_type' | 'order'
>;

type DbSavedQueryVersionSort = {
    saved_queries_version_sort_id: number;
    saved_queries_version_id: number;
    field_name: string;
    descending: boolean;
    order: number;
};

type CreateDbSavedQueryVersionSort = Pick<
    DbSavedQueryVersionSort,
    'saved_queries_version_id' | 'field_name' | 'descending' | 'order'
>;

export const SavedQueryTableCalculationTableName =
    'saved_queries_version_table_calculations';
export type DbSavedQueryTableCalculation = {
    saved_queries_version_table_calculations_id: number;
    name: string;
    display_name: string;
    order: number;
    calculation_raw_sql: string;
    saved_queries_version_id: number;
};

type DbSavedQueryTableCalculationInsert = Omit<
    DbSavedQueryTableCalculation,
    'saved_queries_version_table_calculations_id'
>;
export type SavedQueryTableCalculationTable = Knex.CompositeTableType<
    DbSavedQueryTableCalculation,
    DbSavedQueryTableCalculationInsert
>;

export const getSavedQueryByUuid = async (
    db: Knex,
    savedQueryUuid: string,
): Promise<SavedQuery> => {
    const results = await db<DbSavedQueryDetails>('saved_queries')
        .leftJoin(
            'saved_queries_versions',
            'saved_queries.saved_query_id',
            'saved_queries_versions.saved_query_id',
        )
        .select<DbSavedQueryDetails[]>([
            'saved_queries.saved_query_id',
            'saved_queries.saved_query_uuid',
            'saved_queries.name',
            'saved_queries_versions.saved_queries_version_id',
            'saved_queries_versions.explore_name',
            'saved_queries_versions.filters',
            'saved_queries_versions.row_limit',
            'saved_queries_versions.x_dimension',
            'saved_queries_versions.group_dimension',
            'saved_queries_versions.chart_type',
            'saved_queries_versions.created_at',
        ])
        .where('saved_query_uuid', savedQueryUuid)
        .orderBy('saved_queries_versions.created_at', 'desc')
        .limit(1);
    if (results.length <= 0) {
        throw new NotFoundError('Saved query not found');
    }
    const savedQuery = results[0];
    const yMetrics = await db<DbSavedQueryVersionYMetric>(
        'saved_queries_version_y_metrics',
    )
        .select<DbSavedQueryVersionYMetric[]>(['field_name'])
        .where('saved_queries_version_id', savedQuery.saved_queries_version_id)
        .orderBy('order', 'asc');
    const fields = await db<DbSavedQueryVersionField>(
        'saved_queries_version_fields',
    )
        .select<DbSavedQueryVersionField[]>(['name', 'field_type', 'order'])
        .where('saved_queries_version_id', savedQuery.saved_queries_version_id)
        .orderBy('order', 'asc');
    const sorts = await db<DbSavedQueryVersionSort>(
        'saved_queries_version_sorts',
    )
        .select<DbSavedQueryVersionSort[]>(['field_name', 'descending'])
        .where('saved_queries_version_id', savedQuery.saved_queries_version_id)
        .orderBy('order', 'asc');
    const tableCalculations = await db(
        'saved_queries_version_table_calculations',
    )
        .select(['name', 'display_name', 'calculation_raw_sql', 'order'])
        .where('saved_queries_version_id', savedQuery.saved_queries_version_id);

    const [dimensions, metrics]: [string[], string[]] = fields.reduce<
        [string[], string[]]
    >(
        (result, field) => {
            result[field.field_type === DBFieldTypes.DIMENSION ? 0 : 1].push(
                field.name,
            );
            return result;
        },
        [[], []],
    );

    const columnOrder: string[] = [...fields, ...tableCalculations]
        .sort((a, b) => a.order - b.order)
        .map((x) => x.name);

    return {
        uuid: savedQuery.saved_query_uuid,
        name: savedQuery.name,
        tableName: savedQuery.explore_name,
        updatedAt: savedQuery.created_at,
        metricQuery: {
            dimensions,
            metrics,
            filters: { dimensions: { id: 'root', and: [example] } },
            sorts: sorts.map<SortField>((sort) => ({
                fieldId: sort.field_name,
                descending: sort.descending,
            })),
            limit: savedQuery.row_limit,
            tableCalculations: tableCalculations.map((tableCalculation) => ({
                name: tableCalculation.name,
                displayName: tableCalculation.display_name,
                sql: tableCalculation.calculation_raw_sql,
            })),
        },
        chartConfig: {
            chartType: savedQuery.chart_type,
            seriesLayout: {
                xDimension: savedQuery.x_dimension,
                groupDimension: savedQuery.group_dimension,
                yMetrics: yMetrics.map((yMetric) => yMetric.field_name),
            },
        },
        tableConfig: {
            columnOrder,
        },
    };
};

const createSavedQueryVersionYMetric = async (
    db: Knex,
    data: CreateDbSavedQueryVersionYMetric,
): Promise<DbSavedQueryVersionYMetric> => {
    const results = await db<DbSavedQueryVersionYMetric>(
        'saved_queries_version_y_metrics',
    )
        .insert<CreateDbSavedQueryVersionYMetric>(data)
        .returning('*');
    return results[0];
};

export const deleteSavedQuery = async (
    db: Knex,
    savedQueryUuid: string,
): Promise<void> => {
    await db<DbSavedQuery>('saved_queries')
        .where('saved_query_uuid', savedQueryUuid)
        .delete();
};

export const updateSavedQuery = async (
    savedQueryUuid: string,
    data: UpdateSavedQuery,
): Promise<SavedQuery> => {
    await database<DbSavedQuery>('saved_queries')
        .update<UpdateSavedQuery>(data)
        .where('saved_query_uuid', savedQueryUuid);
    return getSavedQueryByUuid(database, savedQueryUuid);
};

const createSavedQueryVersionField = async (
    db: Knex,
    data: CreateDbSavedQueryVersionField,
): Promise<DbSavedQueryVersionField> => {
    const results = await db<DbSavedQueryVersionField>(
        'saved_queries_version_fields',
    )
        .insert<CreateDbSavedQueryVersionField>(data)
        .returning('*');
    return results[0];
};

const createSavedQueryVersionSort = async (
    db: Knex,
    data: CreateDbSavedQueryVersionSort,
): Promise<DbSavedQueryVersionSort> => {
    const results = await db<DbSavedQueryVersionSort>(
        'saved_queries_version_sorts',
    )
        .insert<CreateDbSavedQueryVersionSort>(data)
        .returning('*');
    return results[0];
};

const createSavedQueryVersionTableCalculation = async (
    db: Knex,
    data: DbSavedQueryTableCalculationInsert,
): Promise<DbSavedQueryTableCalculation> => {
    const results = await db('saved_queries_version_table_calculations')
        .insert(data)
        .returning('*');
    return results[0];
};

export const createSavedQueryVersion = async (
    db: Knex,
    savedQueryId: number,
    {
        tableName,
        metricQuery: {
            limit,
            filters,
            dimensions,
            metrics,
            sorts,
            tableCalculations,
        },
        chartConfig,
        tableConfig,
    }: CreateSavedQueryVersion,
): Promise<void> => {
    await db.transaction(async (trx) => {
        try {
            const results = await trx<DbSavedQueryVersion>(
                'saved_queries_versions',
            )
                .insert<CreateDbSavedQueryVersion>({
                    row_limit: limit,
                    filters: JSON.stringify(filters),
                    explore_name: tableName,
                    saved_query_id: savedQueryId,
                    x_dimension: chartConfig.seriesLayout.xDimension,
                    group_dimension: chartConfig.seriesLayout.groupDimension,
                    chart_type: chartConfig.chartType,
                })
                .returning('*');
            const version = results[0];

            const promises: Promise<any>[] = [];
            (chartConfig.seriesLayout.yMetrics || []).forEach(
                (yMetric, index) => {
                    promises.push(
                        createSavedQueryVersionYMetric(trx, {
                            field_name: yMetric,
                            saved_queries_version_id:
                                version.saved_queries_version_id,
                            order: index,
                        }),
                    );
                },
            );
            dimensions.forEach((dimension) => {
                promises.push(
                    createSavedQueryVersionField(trx, {
                        name: dimension,
                        field_type: DBFieldTypes.DIMENSION,
                        saved_queries_version_id:
                            version.saved_queries_version_id,
                        order: tableConfig.columnOrder.findIndex(
                            (column) => column === dimension,
                        ),
                    }),
                );
            });
            metrics.forEach((metric) => {
                promises.push(
                    createSavedQueryVersionField(trx, {
                        name: metric,
                        field_type: DBFieldTypes.METRIC,
                        saved_queries_version_id:
                            version.saved_queries_version_id,
                        order: tableConfig.columnOrder.findIndex(
                            (column) => column === metric,
                        ),
                    }),
                );
            });
            sorts.forEach((sort, index) => {
                promises.push(
                    createSavedQueryVersionSort(trx, {
                        field_name: sort.fieldId,
                        descending: sort.descending,
                        saved_queries_version_id:
                            version.saved_queries_version_id,
                        order: index,
                    }),
                );
            });
            tableCalculations.forEach((tableCalculation, index) => {
                promises.push(
                    createSavedQueryVersionTableCalculation(trx, {
                        name: tableCalculation.name,
                        display_name: tableCalculation.displayName,
                        calculation_raw_sql: tableCalculation.sql,
                        saved_queries_version_id:
                            version.saved_queries_version_id,
                        order: tableConfig.columnOrder.findIndex(
                            (column) => column === tableCalculation.name,
                        ),
                    }),
                );
            });

            await Promise.all(promises);
        } catch (e) {
            await trx.rollback(e);
            throw e;
        }
    });
};

export const createSavedQuery = async (
    projectUuid: string,
    {
        name,
        tableName,
        metricQuery,
        chartConfig,
        tableConfig,
    }: CreateSavedQuery,
): Promise<SavedQuery> => {
    const newSavedQueryUuid = await database.transaction(async (trx) => {
        try {
            const space = await getSpace(trx, projectUuid);

            const results = await trx<DbSavedQuery>('saved_queries')
                .insert<Pick<DbSavedQuery, 'name'>>({
                    name,
                    space_id: space.space_id,
                })
                .returning('*');
            const newSavedQuery = results[0];

            await createSavedQueryVersion(trx, newSavedQuery.saved_query_id, {
                tableName,
                metricQuery,
                chartConfig,
                tableConfig,
            });

            return newSavedQuery.saved_query_uuid;
        } catch (e) {
            await trx.rollback(e);
            throw e;
        }
    });
    return getSavedQueryByUuid(database, newSavedQueryUuid);
};

export const addSavedQueryVersion = async (
    savedQueryUuid: string,
    data: CreateSavedQueryVersion,
): Promise<SavedQuery> => {
    await database.transaction(async (trx) => {
        try {
            const savedQuery = await database<DbSavedQuery>('saved_queries')
                .select<{ saved_query_id: number }[]>([
                    'saved_queries.saved_query_id',
                ])
                .where('saved_query_uuid', savedQueryUuid)
                .limit(1);

            await createSavedQueryVersion(
                trx,
                savedQuery[0].saved_query_id,
                data,
            );
        } catch (e) {
            await trx.rollback(e);
            throw e;
        }
    });
    return getSavedQueryByUuid(database, savedQueryUuid);
};
