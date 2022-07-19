import 'reflect-metadata';
import { GlobalEvent } from '@dtinsight/molecule/esm/common/event';
import { singleton } from 'tsyringe';
import molecule from '@dtinsight/molecule';
import type { IOfflineTaskProps } from '@/interface';
import type { Rules, RuleType, ValidateError } from 'async-validator';
import ValidSchema from 'async-validator';
import {
	CREATE_MODEL_TYPE,
	DATA_SOURCE_ENUM,
	DATA_SYNC_MODE,
	FLINK_VERSIONS,
	rdbmsDaType,
	SOURCE_TIME_TYPE,
	TASK_TYPE_ENUM,
} from '@/constant';
import { cloneDeep } from 'lodash';
import api from '@/api';
import { message } from 'antd';
import { rightBarService } from '.';
import {
	isAvro,
	isHavePartition,
	isHavePrimaryKey,
	isHaveTableColumn,
	isHaveTableList,
	isHaveTopic,
	isHbase,
	isKafka,
	isLowerES,
	isRDB,
	isRedis,
	isS3,
} from '@/utils/is';
import { checkColumnsData } from '@/pages/editor/streamCollection/taskFunc';

interface IParamsProps extends IOfflineTaskProps {
	// 接口要求的标记位
	preSave?: boolean;
	// 接口要求的标记位
	updateSource?: boolean;
	/**
	 * the monaco editor content
	 */
	value?: string;
}

enum SaveEventKind {
	onSaveTask = 'onsave',
}

@singleton()
class TaskSaveService extends GlobalEvent {
	/**
	 * 校验器，用于发起校验以及校验结束后提示错误信息
	 */
	private async dataValidator<T extends any[]>(
		currentPage: IOfflineTaskProps,
		data: T,
		validator: (
			item: T[number],
			version: IOfflineTaskProps['componentVersion'],
		) => Promise<ValidateError[] | null>,
		text: string,
	) {
		const { componentVersion } = currentPage;
		const errors = await Promise.all(data.map((item) => validator(item, componentVersion)));
		errors.forEach((error, index) => {
			if (error) {
				const tableName = data[index]?.tableName;
				message.error(
					`${text} ${index + 1} ${tableName ? `(${tableName})` : ''}: ${
						error[0].message
					}`,
				);
			}
		});
		return errors;
	}

	/**
	 * 动态生成 Flink 结果表的校验规则
	 */
	private generateValidDesOutPut(
		data?: IOfflineTaskProps['sink'][number],
		componentVersion?: Valueof<typeof FLINK_VERSIONS>,
	): Rules {
		const schemaRequired =
			data?.type &&
			[
				DATA_SOURCE_ENUM.POSTGRESQL,
				DATA_SOURCE_ENUM.KINGBASE8,
				DATA_SOURCE_ENUM.SQLSERVER,
				DATA_SOURCE_ENUM.SQLSERVER_2017_LATER,
			].includes(data.type);
		const isFlink112 = componentVersion === FLINK_VERSIONS.FLINK_1_12;

		return {
			type: [{ required: true, message: '请选择存储类型' }],
			sourceId: [{ required: true, message: '请选择数据源' }],
			topic: [{ required: isHaveTopic(data?.type), message: '请选择Topic' }],
			table: [
				{ required: isHaveTableList(data?.type) && !isS3(data?.type), message: '请选择表' },
			],
			tableName: [{ required: true, message: '请输入映射表名' }],
			columns: [
				{
					required: isHaveTableColumn(data?.type),
					message: '字段信息不能为空',
					type: 'array' as RuleType,
				},
				{ validator: checkColumnsData },
			],
			columnsText: [
				{ required: !isHaveTableColumn(data?.type), message: '字段信息不能为空' },
			],
			collection: [
				{ required: data?.type === DATA_SOURCE_ENUM.SOLR, message: '请选择Collection' },
			],
			objectName: [{ required: isS3(data?.type), message: '请输入ObjectName' }],
			schema: [{ required: schemaRequired, message: '请选择schema' }],
			partitionfields: [
				{
					required:
						isHavePartition(data?.type) &&
						// @ts-ignore
						data?.isShowPartition &&
						// @ts-ignore
						data?.havePartitionfields,
					message: '请选择分区',
				},
			],
			'table-input': [{ required: isRedis(data?.type), message: '请输入表名' }],
			index: [{ required: isLowerES(data?.type), message: '请输入索引' }],
			'primaryKey-input': [{ required: isRedis(data?.type), message: '请输入主键' }],
			esType: [{ required: isLowerES(data?.type), message: '请输入索引类型' }],
			rowKey: [{ required: isHbase(data?.type), message: '请输入rowKey' }],
			rowKeyType: [
				{ required: isHbase(data?.type) && isFlink112, message: '请输入rowKey类型' },
			],
			sinkDataType: [{ required: isKafka(data?.type), message: '请选择输出类型！' }],
			updateMode: [{ required: true, message: '请选择更新模式' }],
			primaryKey: [
				{
					required: data?.updateMode === 'upsert' && isHavePrimaryKey(data?.type),
					message: '请输入主键',
				},
			],
			partitionKeys: [{ required: data?.enableKeyPartitions, message: '请选择分区字段' }],
			batchWaitInterval: [{ required: isRDB(data?.type), message: '请输入数据输出时间' }],
			batchSize: [{ required: isRDB(data?.type), message: '请输入数据输出条数' }],
		};
	}

	/**
	 * 动态生成 Flink 的维表校验字段
	 */
	private generateValidDesSide(
		data: IOfflineTaskProps['side'][number],
		componentVersion?: Valueof<typeof FLINK_VERSIONS>,
	): Rules {
		const isCacheLRU = data?.cache === 'LRU';
		const isCacheTLLMSReqiured = data?.cache === 'LRU' || data?.cache === 'ALL';
		const schemaRequired = [
			DATA_SOURCE_ENUM.POSTGRESQL,
			DATA_SOURCE_ENUM.KINGBASE8,
			DATA_SOURCE_ENUM.SQLSERVER,
			DATA_SOURCE_ENUM.SQLSERVER_2017_LATER,
		].includes(data?.type);
		const isFlink112 = componentVersion === FLINK_VERSIONS.FLINK_1_12;

		return {
			type: [{ required: true, message: '请选择存储类型' }],
			sourceId: [{ required: true, message: '请选择数据源' }],
			table: [{ required: isHaveTableList(data?.type), message: '请选择表' }],
			tableName: [{ required: true, message: '请输入映射表名' }],
			columns: [
				{
					required: isHaveTableColumn(data?.type),
					message: '字段信息不能为空',
					type: 'array',
				},
				{ validator: checkColumnsData },
			],
			columnsText: [
				{ required: !isHaveTableColumn(data?.type), message: '字段信息不能为空' },
			],
			schema: [{ required: schemaRequired, message: '请选择Schema' }],
			// 'table-input': [{ required: isRedis, message: '请输入表名' }],
			index: [{ required: isLowerES(data?.type), message: '请输入索引' }],
			esType: [{ required: isLowerES(data?.type), message: '请输入索引类型' }],
			primaryKey: [{ required: false, message: '请输入主键' }],
			// 'primaryKey-input': [{ required: isRedis || isMongoDB, message: '请输入主键' }],
			hbasePrimaryKey: [{ required: isHbase(data?.type), message: '请输入主键' }],
			hbasePrimaryKeyType: [
				{ required: isHbase(data?.type) && isFlink112, message: '请输入主键类型' },
			],
			cache: [{ required: true, message: '请选择缓存策略' }],
			cacheSize: [{ required: isCacheLRU, message: '请输入缓存大小' }],
			cacheTTLMs: [{ required: isCacheTLLMSReqiured, message: '请输入缓存超时时间' }],
		};
	}

	/**
	 * 校验 Flink 的源表表单值
	 */
	private async validDataSource(
		data: IOfflineTaskProps['source'][number],
		componentVersion?: Valueof<typeof FLINK_VERSIONS>,
	) {
		const validDes = this.generateValidDesSource(data, componentVersion);
		const validator = new ValidSchema(validDes);
		const err = await new Promise<ValidateError[] | null>((resolve) => {
			validator.validate(data, (errors) => {
				resolve(errors);
			});
		});
		return err;
	}

	/**
	 * 校验 Flink 的结果表
	 */
	private async validDataOutput(
		data: IOfflineTaskProps['sink'][number],
		componentVersion?: Valueof<typeof FLINK_VERSIONS>,
	) {
		const validDes = this.generateValidDesOutPut(data, componentVersion);
		const validator = new ValidSchema(validDes);
		const err = await new Promise<ValidateError[] | null>((resolve) => {
			validator.validate(data, (errors) => {
				resolve(errors);
			});
		});
		return err;
	}

	/**
	 * 校验 Flink 维表
	 */
	private async validDataSide(
		data: IOfflineTaskProps['side'][number],
		componentVersion?: Valueof<typeof FLINK_VERSIONS>,
	) {
		const validDes = this.generateValidDesSide(data, componentVersion);
		const validator = new ValidSchema(validDes);
		const err = await new Promise<ValidateError[] | null>((resolve) => {
			validator.validate(data, (errors) => {
				resolve(errors);
			});
		});
		return err;
	}

	private async validTableData(currentPage: IOfflineTaskProps) {
		const VALID_FIELDS = ['source', 'sink', 'side'] as const;
		const FIELDS_MAPPING = { source: '源表', sink: '结果表', side: '维表' } as const;
		const FIELDS_VALID_FUNCTION_MAPPING = {
			source: this.validDataSource,
			sink: this.validDataOutput,
			side: this.validDataSide,
		} as const;
		return Promise.all(
			VALID_FIELDS.map((key) => {
				const tableData = currentPage[key];
				return this.dataValidator(
					currentPage,
					tableData,
					// @ts-ignore
					FIELDS_VALID_FUNCTION_MAPPING[key],
					FIELDS_MAPPING[key],
				);
			}),
		);
	}

	private checkSide(sides: IOfflineTaskProps['side'], componentVersion: string) {
		if (sides) {
			for (let i = 0; i < sides.length; i += 1) {
				const side = sides[i];
				const { type, primaryKey, hbasePrimaryKey, hbasePrimaryKeyType } = side;
				switch (type) {
					case DATA_SOURCE_ENUM.REDIS:
					case DATA_SOURCE_ENUM.UPRedis: {
						if (!primaryKey || !primaryKey.length) {
							return `维表${i + 1}中的主键不能为空`;
						}
						return null;
					}
					case DATA_SOURCE_ENUM.HBASE:
					case DATA_SOURCE_ENUM.TBDS_HBASE:
					case DATA_SOURCE_ENUM.HBASE_HUAWEI: {
						if (!hbasePrimaryKey) {
							return `维表${i + 1}中的主键不能为空`;
						}
						if (!hbasePrimaryKeyType && componentVersion === '1.12') {
							return `维表${i + 1}中的主键类型不能为空`;
						}
						return null;
					}
					default:
						return null;
				}
			}
		}
		return null;
	}

	/**
	 * 为 Flink 的源表表单生成校验规则
	 */
	public generateValidDesSource(
		data: IOfflineTaskProps['source'][number],
		componentVersion?: Valueof<typeof FLINK_VERSIONS>,
	) {
		const isFlink112 = componentVersion === FLINK_VERSIONS.FLINK_1_12;
		const haveSchema =
			isKafka(data?.type) &&
			isAvro(data?.sourceDataType) &&
			componentVersion !== FLINK_VERSIONS.FLINK_1_12;

		return {
			type: [{ required: true, message: '请选择类型' }],
			sourceId: [{ required: true, message: '请选择数据源' }],
			topic: [{ required: true, message: '请选择Topic' }],
			table: [{ required: true, message: '请输入映射表名' }],
			columnsText: [{ required: true, message: '字段信息不能为空！' }],
			sourceDataType: [{ required: isKafka(data?.type), message: '请选择读取类型' }],
			schemaInfo: [{ required: !!haveSchema, message: '请输入Schema' }],
			timeColumn: [
				{
					required:
						(!isFlink112 && data?.timeType === SOURCE_TIME_TYPE.EVENT_TIME) ||
						(isFlink112 && data?.timeTypeArr?.includes?.(SOURCE_TIME_TYPE.EVENT_TIME)),
					message: '请选择时间列',
				},
			],
			offset: [
				{
					required:
						(!isFlink112 && data?.timeType === SOURCE_TIME_TYPE.EVENT_TIME) ||
						(isFlink112 && data?.timeTypeArr?.includes?.(SOURCE_TIME_TYPE.EVENT_TIME)),
					message: '请输入最大延迟时间',
				},
			],
		};
	}

	public transformTabDataToParams(data: IOfflineTaskProps) {
		const params: IOfflineTaskProps & { value?: string } = { ...data };
		params.sqlText = params.value || '';

		if (params.componentVersion === FLINK_VERSIONS.FLINK_1_12 && Array.isArray(params.source)) {
			params.source.forEach((form) => {
				if (form.timeTypeArr.includes(1)) {
					// eslint-disable-next-line no-param-reassign
					form.procTime = form.procTime || 'proc_time';
				}
			});
		}

		return params;
	}

	save() {
		const currentTask = molecule.editor.getState().current?.tab;
		if (!currentTask) return Promise.reject();
		const data = currentTask.data as IParamsProps;

		const { taskType } = data;
		switch (taskType) {
			case TASK_TYPE_ENUM.SYNC: {
				const params: IParamsProps = cloneDeep(data);
				const DATASYNC_FIELDS = ['settingMap', 'sourceMap', 'targetMap'] as const;
				// 向导模式需要去检查填写是否正确
				if (params.createModel === CREATE_MODEL_TYPE.GUIDE) {
					if (DATASYNC_FIELDS.every((f) => params.hasOwnProperty(f) && params[f])) {
						const isIncrementMode =
							params.sourceMap.syncModel !== undefined &&
							DATA_SYNC_MODE.INCREMENT === params.sourceMap.syncModel;
						if (!isIncrementMode) {
							params.sourceMap!.increColumn = undefined; // Delete increColumn
						}

						// 服务端需要的参数
						params.sourceMap!.rdbmsDaType = rdbmsDaType.Poll;
					} else {
						return Promise.reject(new Error('请检查数据同步任务是否填写正确'));
					}
				}

				// 修改task配置时接口要求的标记位
				params.preSave = true;
				params.sqlText = params.value || '';

				return api.saveOfflineJobData(params).then((res) => {
					if (res.code === 1) {
						message.success('保存成功！');
						this.emit(SaveEventKind.onSaveTask, res.data);
						return res;
					}
					return Promise.reject();
				});
			}
			case TASK_TYPE_ENUM.SQL: {
				const params: IParamsProps = cloneDeep(data);
				const { componentVersion, createModel, side = [] } = params;
				const isFlinkSQLGuide = createModel === CREATE_MODEL_TYPE.GUIDE || !createModel;

				/**
				 * 如果是向导模式，校验源表和结果表和维表
				 */
				if (isFlinkSQLGuide) {
					// errors 的二维数组，第一维区分源表结果表维表，第二维区分具体表中的某一个源
					const validation = () =>
						this.validTableData(params)
							.then((errors) => {
								// 如果所有的结果都是 null 则表示校验全通过,否则不通过
								if (
									!errors.every((tableErrors) =>
										tableErrors.every((e) => e === null),
									)
								) {
									return Promise.reject();
								}

								const err = this.checkSide(side, componentVersion);
								if (err) {
									message.error(err);
									return Promise.reject();
								}

								params.preSave = true;
								// 后端区分右键编辑保存
								params.updateSource = true;

								return params;
							})
							.then((preParams) => this.transformTabDataToParams(preParams))
							.then((realParams) => {
								return api.saveTask(realParams).then((res) => {
									if (res.code === 1) {
										message.success('保存成功！');
										this.emit(SaveEventKind.onSaveTask, res.data);
										return res;
									}
									return Promise.reject();
								});
							});

					const componentForm = rightBarService.getForm();
					if (componentForm) {
						// 如果 componentForm 存在表示当前 rightBar 处于展开状态并且存在 form 表单，需要先校验表单的值
						return componentForm
							.validateFields()
							.then(() => validation())
							.catch(() => Promise.reject());
					}

					return validation();
				}

				const { value, ...restParams } = params;
				return api
					.saveTask({
						...restParams,
						sqlText: value,
						preSave: true,
						// 后端区分右键编辑保存
						updateSource: true,
					})
					.then((res) => {
						if (res.code === 1) {
							message.success('保存成功！');
							this.emit(SaveEventKind.onSaveTask, res.data);
							return res;
						}
						return Promise.reject();
					});
			}
			case TASK_TYPE_ENUM.DATA_ACQUISITION: {
				const params: IParamsProps = cloneDeep(data);
				const { sourceMap, targetMap = {}, createModel } = params;

				const componentForm = rightBarService.getForm();

				const validation = () => {
					/**
					 * 当目标数据源为Hive时，必须勾选Json平铺
					 */
					const haveJson =
						isKafka(sourceMap?.type) ||
						sourceMap?.type === DATA_SOURCE_ENUM.EMQ ||
						sourceMap?.type === DATA_SOURCE_ENUM.SOCKET;
					if (
						targetMap?.type === DATA_SOURCE_ENUM.HIVE &&
						!sourceMap.pavingData &&
						!haveJson
					) {
						message.error('请勾选嵌套Json平铺后重试');
						return Promise.reject();
					}

					params.preSave = true;
					// 后端区分右键编辑保存
					params.updateSource = true;
					params.sqlText = params.value || '';

					if (createModel === CREATE_MODEL_TYPE.GUIDE) {
						const { distributeTable } = sourceMap;
						/**
						 * [ {name:'table', table: []} ] => {'table':[]}
						 */
						if (distributeTable && distributeTable.length) {
							const newDistributeTable: any = {};
							distributeTable.forEach((table: any) => {
								newDistributeTable[table.name] = table.tables || [];
							});
							params.sourceMap = {
								...sourceMap,
								distributeTable: newDistributeTable,
							};
						}

						Reflect.deleteProperty(params, 'sourceParams');
						Reflect.deleteProperty(params, 'sinkParams');
						Reflect.deleteProperty(params, 'sideParams');
					}

					return api.saveTask(params).then((res) => {
						if (res.code === 1) {
							message.success('保存成功！');
							this.emit(SaveEventKind.onSaveTask, res.data);
							return res;
						}
						return Promise.reject();
					});
				};

				if (componentForm) {
					return componentForm
						.validateFields()
						.then(validation)
						.catch(() => Promise.reject());
				}

				return validation();
			}
			case TASK_TYPE_ENUM.SPARK_SQL:
			case TASK_TYPE_ENUM.HIVE_SQL:
			default: {
				// 默认保存，通过把 editor 中的值给到 sqlText 进行保存
				const { value, ...restData } = data;

				return api
					.saveOfflineJobData({
						...restData,
						sqlText: value || '',
						// 修改task配置时接口要求的标记位
						preSave: true,
					})
					.then((res) => {
						if (res.code === 1) {
							message.success('保存成功！');
							this.emit(SaveEventKind.onSaveTask, res.data);
							return res;
						}
						return Promise.reject();
					});
			}
		}
	}

	/**
	 * 保存任务成功的回调函数
	 */
	onSaveTask(listener: (task: IOfflineTaskProps) => void) {
		this.subscribe(SaveEventKind.onSaveTask, listener);
	}
}

export default new TaskSaveService();