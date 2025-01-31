/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.dtstack.taier.datasource.plugin.hive1;

import com.dtstack.taier.datasource.plugin.common.DtClassConsistent;
import com.dtstack.taier.datasource.plugin.common.constant.CommonConstant;
import com.dtstack.taier.datasource.plugin.common.exception.ErrorCode;
import com.dtstack.taier.datasource.plugin.common.utils.PropertiesUtil;
import com.dtstack.taier.datasource.plugin.common.utils.ReflectUtil;
import com.dtstack.taier.datasource.plugin.common.utils.SSLUtil;
import com.dtstack.taier.datasource.plugin.common.utils.SqlFormatUtil;
import com.dtstack.taier.datasource.plugin.kerberos.core.util.KerberosLoginUtil;
import com.dtstack.taier.datasource.plugin.rdbms.ConnFactory;
import com.dtstack.taier.datasource.api.dto.SqlQueryDTO;
import com.dtstack.taier.datasource.api.dto.source.Hive1SourceDTO;
import com.dtstack.taier.datasource.api.dto.source.ISourceDTO;
import com.dtstack.taier.datasource.api.exception.SourceException;
import com.dtstack.taier.datasource.api.source.DataBaseType;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.BooleanUtils;
import org.apache.commons.lang3.StringUtils;

import java.security.PrivilegedAction;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Collections;
import java.util.List;
import java.util.Properties;

/**
 * @company: www.dtstack.com
 * @Author ：Nanqi
 * @Date ：Created in 17:07 2020/1/7
 * @Description：Hive 连接池工厂
 */
@Slf4j
public class HiveConnFactory extends ConnFactory {

    private static final String SSL_FLAG = "ssl";

    private static final String SSL_TRUST_STORE = "sslTrustStore";

    private static final String SSL_STORE_PASSWORD = "trustStorePassword";

    private static final String SUB_TYPE_INCEPTOR = "INCEPTOR";

    public HiveConnFactory() {
        this.driverName = DataBaseType.HIVE1X.getDriverClassName();
        this.testSql = DataBaseType.HIVE1X.getTestSql();
        this.errorPattern = new Hive1ErrorPattern();
    }

    @Override
    public Connection getConn(ISourceDTO sourceDTO) throws Exception {
        init();
        Hive1SourceDTO hive1SourceDTO = (Hive1SourceDTO) sourceDTO;

        Connection connection = KerberosLoginUtil.loginWithUGI(hive1SourceDTO.getKerberosConfig()).doAs(
                (PrivilegedAction<Connection>) () -> {
                    try {
                        DriverManager.setLoginTimeout(30);
                        Properties properties = new Properties();
                        SSLUtil.SSLConfiguration sslConfiguration = SSLUtil.getSSLConfiguration(hive1SourceDTO);
                        dealSsl(properties, sslConfiguration);
                        properties.put(DtClassConsistent.PublicConsistent.USER, hive1SourceDTO.getUsername() == null ? "" : hive1SourceDTO.getUsername());
                        properties.put(DtClassConsistent.PublicConsistent.PASSWORD, hive1SourceDTO.getPassword() == null ? "" : hive1SourceDTO.getPassword());

                        PropertiesUtil.convertToProp(hive1SourceDTO, properties);
                        setQueue(properties, hive1SourceDTO);
                        String urlWithoutSchema = HiveDriverUtil.removeSchema(hive1SourceDTO.getUrl());
                        return DriverManager.getConnection(urlWithoutSchema, properties);
                    } catch (SQLException e) {
                        // 对异常进行统一处理
                        throw new SourceException(errorAdapter.connAdapter(e.getMessage(), errorPattern), e);
                    }
                }
        );

        return HiveDriverUtil.setSchema(connection, hive1SourceDTO.getUrl(), hive1SourceDTO.getSchema());
    }

    /**
     * 设置 hive 使用的 yarn queue
     *
     * @param properties    配置信息
     * @param hiveSourceDTO 数据源配置
     */
    private void setQueue(Properties properties, Hive1SourceDTO hiveSourceDTO) {
        String queue = ReflectUtil.getFieldValueNotThrow(String.class, hiveSourceDTO, "queue", null);
        if (StringUtils.isNotBlank(queue)) {
            properties.setProperty(CommonConstant.MAPREDUCE_JOB_QUEUENAME, queue);
            properties.setProperty(CommonConstant.TEZ_QUEUE_NAME, queue);
        }
    }

    /**
     * 处理hive ssl认证信息
     *
     * @param properties       jdbc properties
     * @param sslConfiguration ssl 认证信息
     */
    private void dealSsl(Properties properties, SSLUtil.SSLConfiguration sslConfiguration) {
        if (sslConfiguration == null) {
            return;
        }

        // 兼容一下 keystore 和 truststore
        String storePath = StringUtils.isNotBlank(sslConfiguration.getTrustStorePath()) ?
                sslConfiguration.getTrustStorePath() : sslConfiguration.getKeyStorePath();

        if (StringUtils.isBlank(storePath)) {
            throw new SourceException("hive ssl Certification lack certificate path");
        }

        properties.put(SSL_FLAG, BooleanUtils.toStringTrueFalse(true));
        properties.put(SSL_TRUST_STORE, storePath);
        if (StringUtils.isNotBlank(sslConfiguration.getKeyStorePassword())) {
            properties.put(SSL_STORE_PASSWORD, sslConfiguration.getKeyStorePassword());
        }
    }

    @Override
    protected List<String> buildSqlList(SqlQueryDTO queryDTO) {
        if (queryDTO.getHiveSubType() != null
                && SUB_TYPE_INCEPTOR.equalsIgnoreCase(queryDTO.getHiveSubType())) {
            String sql = "BEGIN\n" + queryDTO.getSql() + "\nEND;\n";
            return Collections.singletonList(sql);
        } else {
            return SqlFormatUtil.splitIgnoreQuota(queryDTO.getSql(), ';');
        }
    }

    @Override
    protected String getCallProc(String procName) {
        throw new SourceException(ErrorCode.NOT_SUPPORT.getDesc());
    }

    protected boolean supportTransaction() {
        return false;
    }

    protected boolean supportSelectSql() {
        return true;
    }

    protected boolean supportProcedure(String sql) {
        return false;
    }

    protected String getDropProc(String procName) {
        throw new SourceException(ErrorCode.NOT_SUPPORT.getDesc());
    }
}
