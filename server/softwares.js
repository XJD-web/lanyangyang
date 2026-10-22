// 软件清单数据源（云端维护，前端 App.vue 在 onMounted 拉取）
// 分类 key 必须与前端 categories 的 key 一致：
//   java / python / frontend / database / bigdata / container / middleware / tools
//
// 每条记录的字段：
//   name      软件名（卡片标题）
//   version   推荐版本（同时作为版本下拉框默认项）
//   url       推荐版本的下载地址（.zip 会被客户端自动解压；.exe/.msi 直接落盘）
//   path      安装子目录（相对路径，如 'jdk'），客户端会拼接到用户选择的工作空间下，
//             这样同一份云端清单可适配任意客户机的本地路径（客户端无关）
//   versions  可选：版本下拉框的可选项数组
//   downloads 可选：{ 版本: 下载地址 } 映射，支持切换版本时取对应安装包
//   env       可选：一键配置环境变量时使用的规则
//             { name: 'JAVA_HOME', bin: 'bin' } -> 设置 JAVA_HOME 并把 <安装目录>/bin 加入 Path
//             { name: null, bin: '' }           -> 只把 <安装目录> 加入 Path
//             { name: null, bin: null }          -> 不做任何环境变量处理（如 IDE 安装器）
//   check     可选：用于「检测已装环境」的命令行可执行名（如 'java'）；为 null 时跳过命令探测
//   markers   可选：用于「全盘盘符扫描」的标志文件相对路径（相对于安装根目录 HOME）。
//             客户端会遍历本机所有盘符的候选安装目录（Program Files、用户目录、常见自定义目录等），
//             查找这些文件来判定是否已安装，并据此反推出安装根目录（HOME）。
//             例如 JDK 写 ['bin/java.exe','bin/javac.exe']；Python 写 ['python.exe']（可执行文件就在根目录）。

const softwares = {
  // ===================== Java 生态 =====================
  java: [
    {
      name: 'JDK',
      version: 'JDK 17.0.10',
      url: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.10_7.zip',
      path: 'jdk',
      check: 'java',
      env: { name: 'JAVA_HOME', bin: 'bin', markers: ['bin/java.exe', 'bin/javac.exe'] },
      versions: ['JDK 8u402', 'JDK 11.0.22', 'JDK 17.0.10', 'JDK 21.0.2'],
      downloads: {
        'JDK 8u402': 'https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u402-b06/OpenJDK8U-jdk_x64_windows_hotspot_8u402b06.zip',
        'JDK 11.0.22': 'https://github.com/adoptium/temurin11-binaries/releases/download/jdk-11.0.22%2B7/OpenJDK11U-jdk_x64_windows_hotspot_11.0.22_7.zip',
        'JDK 17.0.10': 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.10_7.zip',
        'JDK 21.0.2': 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jdk_x64_windows_hotspot_21.0.2_13.zip',
      },
    },
    {
      name: 'Maven',
      version: 'Maven 3.9.9',
      url: 'https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.zip',
      path: 'maven',
      check: 'mvn',
      env: { name: 'MAVEN_HOME', bin: 'bin', markers: ['bin/mvn.cmd', 'bin/mvn.exe'] },
      versions: ['Maven 3.8.8', 'Maven 3.9.9'],
      downloads: {
        'Maven 3.8.8': 'https://archive.apache.org/dist/maven/maven-3/3.8.8/binaries/apache-maven-3.8.8-bin.zip',
        'Maven 3.9.9': 'https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.zip',
      },
    },
    {
      name: 'Gradle',
      version: 'Gradle 8.10',
      url: 'https://services.gradle.org/distributions/gradle-8.10-bin.zip',
      path: 'gradle',
      check: 'gradle',
      env: { name: 'GRADLE_HOME', bin: 'bin', markers: ['bin/gradle.bat', 'bin/gradle.exe'] },
      versions: ['Gradle 8.5', 'Gradle 8.10'],
      downloads: {
        'Gradle 8.5': 'https://services.gradle.org/distributions/gradle-8.5-bin.zip',
        'Gradle 8.10': 'https://services.gradle.org/distributions/gradle-8.10-bin.zip',
      },
    },
    {
      name: 'Tomcat',
      version: 'Tomcat 10.1.30',
      url: 'https://archive.apache.org/dist/tomcat/tomcat-10/v10.1.30/bin/apache-tomcat-10.1.30.zip',
      path: 'tomcat',
      check: 'catalina',
      env: { name: 'CATALINA_HOME', bin: 'bin', markers: ['bin/catalina.bat'] },
      versions: ['Tomcat 9.0.98', 'Tomcat 10.1.30'],
      downloads: {
        'Tomcat 9.0.98': 'https://archive.apache.org/dist/tomcat/tomcat-9/v9.0.98/bin/apache-tomcat-9.0.98.zip',
        'Tomcat 10.1.30': 'https://archive.apache.org/dist/tomcat/tomcat-10/v10.1.30/bin/apache-tomcat-10.1.30.zip',
      },
    },
    {
      name: 'IntelliJ IDEA',
      version: 'IDEA 2024.2.4 (Community)',
      url: 'https://download.jetbrains.com/idea/ideaIC-2024.2.4.exe',
      path: 'idea',
      check: null,
      env: { name: null, bin: null, markers: ['bin/idea64.exe'] },
      versions: ['IDEA 2024.2.4 (Community)'],
      downloads: {
        'IDEA 2024.2.4 (Community)': 'https://download.jetbrains.com/idea/ideaIC-2024.2.4.exe',
      },
    },
  ],

  // ===================== Python 生态 =====================
  python: [
    {
      name: 'Python',
      version: 'Python 3.12.7',
      url: 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip',
      path: 'python',
      check: 'python',
      env: { name: null, bin: '', markers: ['python.exe'] },
      versions: ['Python 3.10.14', 'Python 3.11.9', 'Python 3.12.7'],
      downloads: {
        'Python 3.10.14': 'https://www.python.org/ftp/python/3.10.14/python-3.10.14-embed-amd64.zip',
        'Python 3.11.9': 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip',
        'Python 3.12.7': 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip',
      },
    },
    {
      name: 'Miniconda',
      version: 'Miniconda 24.7.1',
      url: 'https://repo.anaconda.com/miniconda/Miniconda3-24.7.1-0-Windows-x86_64.exe',
      path: 'miniconda',
      check: 'conda',
      env: { name: 'CONDA_HOME', bin: 'Scripts', markers: ['Scripts/conda.exe', 'conda.exe'] },
      versions: ['Miniconda 24.3.0', 'Miniconda 24.7.1'],
      downloads: {
        'Miniconda 24.3.0': 'https://repo.anaconda.com/miniconda/Miniconda3-24.3.0-0-Windows-x86_64.exe',
        'Miniconda 24.7.1': 'https://repo.anaconda.com/miniconda/Miniconda3-24.7.1-0-Windows-x86_64.exe',
      },
    },
    {
      name: 'Anaconda',
      version: 'Anaconda 2024.10',
      url: 'https://repo.anaconda.com/archive/Anaconda3-2024.10-1-Windows-x86_64.exe',
      path: 'anaconda',
      check: 'conda',
      env: { name: 'CONDA_HOME', bin: 'Scripts', markers: ['Scripts/conda.exe'] },
      versions: ['Anaconda 2024.10'],
      downloads: {
        'Anaconda 2024.10': 'https://repo.anaconda.com/archive/Anaconda3-2024.10-1-Windows-x86_64.exe',
      },
    },
    {
      name: 'PyCharm',
      version: 'PyCharm 2024.2.4 (Community)',
      url: 'https://download.jetbrains.com/python/pycharm-community-2024.2.4.exe',
      path: 'pycharm',
      check: null,
      env: { name: null, bin: null, markers: ['bin/pycharm64.exe'] },
      versions: ['PyCharm 2024.2.4 (Community)'],
      downloads: {
        'PyCharm 2024.2.4 (Community)': 'https://download.jetbrains.com/python/pycharm-community-2024.2.4.exe',
      },
    },
  ],

  // ===================== 前端生态 =====================
  frontend: [
    {
      name: 'Node.js',
      version: 'Node 20.18.0',
      url: 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip',
      path: 'nodejs',
      check: 'node',
      env: { name: null, bin: '', markers: ['node.exe'] },
      versions: ['Node 18.20.4', 'Node 20.18.0', 'Node 22.11.0'],
      downloads: {
        'Node 18.20.4': 'https://nodejs.org/dist/v18.20.4/node-v18.20.4-win-x64.zip',
        'Node 20.18.0': 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip',
        'Node 22.11.0': 'https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip',
      },
    },
    {
      name: 'pnpm',
      version: 'pnpm 9.12.0',
      url: 'https://github.com/pnpm/pnpm/releases/download/v9.12.0/pnpm-win-x64.exe',
      path: 'pnpm',
      check: 'pnpm',
      env: { name: null, bin: '', markers: ['pnpm.exe'] },
      versions: ['pnpm 9.4.0', 'pnpm 9.12.0'],
      downloads: {
        'pnpm 9.4.0': 'https://github.com/pnpm/pnpm/releases/download/v9.4.0/pnpm-win-x64.exe',
        'pnpm 9.12.0': 'https://github.com/pnpm/pnpm/releases/download/v9.12.0/pnpm-win-x64.exe',
      },
    },
    {
      name: 'yarn',
      version: 'yarn 1.22.22',
      url: 'https://github.com/yarnpkg/yarn/releases/download/v1.22.22/yarn-1.22.22.msi',
      path: 'yarn',
      check: 'yarn',
      env: { name: null, bin: null, markers: ['bin/yarn.cmd', 'yarn.cmd'] },
      versions: ['yarn 1.22.22'],
      downloads: {
        'yarn 1.22.22': 'https://github.com/yarnpkg/yarn/releases/download/v1.22.22/yarn-1.22.22.msi',
      },
    },
    {
      name: 'VS Code',
      version: 'VS Code 1.95.2',
      url: 'https://update.code.visualstudio.com/1.95.2/win32-x64-archive/zip',
      path: 'vscode',
      check: null,
      env: { name: null, bin: 'bin', markers: ['bin/code.cmd', 'Code.exe'] },
      versions: ['VS Code 1.95.2'],
      downloads: {
        'VS Code 1.95.2': 'https://update.code.visualstudio.com/1.95.2/win32-x64-archive/zip',
      },
    },
    {
      name: 'WebStorm',
      version: 'WebStorm 2024.2.4',
      url: 'https://download.jetbrains.com/webstorm/WebStorm-2024.2.4.exe',
      path: 'webstorm',
      check: null,
      env: { name: null, bin: null, markers: ['bin/webstorm64.exe'] },
      versions: ['WebStorm 2024.2.4'],
      downloads: {
        'WebStorm 2024.2.4': 'https://download.jetbrains.com/webstorm/WebStorm-2024.2.4.exe',
      },
    },
  ],

  // ===================== 数据库 =====================
  database: [
    {
      name: 'MySQL',
      version: 'MySQL 8.4.2',
      url: 'https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-8.4.2-winx64.zip',
      path: 'mysql',
      check: 'mysql',
      env: { name: 'MYSQL_HOME', bin: 'bin', markers: ['bin/mysql.exe'] },
      versions: ['MySQL 8.0.38', 'MySQL 8.4.2'],
      downloads: {
        'MySQL 8.0.38': 'https://dev.mysql.com/get/Downloads/MySQL-8.0/mysql-8.0.38-winx64.zip',
        'MySQL 8.4.2': 'https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-8.4.2-winx64.zip',
      },
    },
    {
      name: 'PostgreSQL',
      version: 'PostgreSQL 17.0',
      url: 'https://get.enterprisedb.com/postgresql/postgresql-17.0-1-windows-x64-binaries.zip',
      path: 'postgresql',
      check: 'psql',
      env: { name: null, bin: 'bin', markers: ['bin/psql.exe'] },
      versions: ['PostgreSQL 16.4', 'PostgreSQL 17.0'],
      downloads: {
        'PostgreSQL 16.4': 'https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip',
        'PostgreSQL 17.0': 'https://get.enterprisedb.com/postgresql/postgresql-17.0-1-windows-x64-binaries.zip',
      },
    },
    {
      name: 'Redis',
      version: 'Redis 5.0.14.1',
      url: 'https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip',
      path: 'redis',
      check: 'redis-server',
      env: { name: null, bin: '', markers: ['redis-server.exe'] },
      versions: ['Redis 5.0.14.1'],
      downloads: {
        'Redis 5.0.14.1': 'https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip',
      },
    },
    {
      name: 'MongoDB',
      version: 'MongoDB 7.0.14',
      url: 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.14.zip',
      path: 'mongodb',
      check: 'mongod',
      env: { name: 'MONGODB_HOME', bin: 'bin', markers: ['bin/mongod.exe'] },
      versions: ['MongoDB 7.0.14'],
      downloads: {
        'MongoDB 7.0.14': 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.14.zip',
      },
    },
    {
      name: 'MariaDB',
      version: 'MariaDB 11.5.2',
      url: 'https://downloads.mariadb.org/interstitial/mariadb-11.5.2/winx64-packages/mariadb-11.5.2-winx64.zip',
      path: 'mariadb',
      check: 'mariadb',
      env: { name: 'MARIADB_HOME', bin: 'bin', markers: ['bin/mariadb.exe', 'bin/mysql.exe'] },
      versions: ['MariaDB 11.5.2'],
      downloads: {
        'MariaDB 11.5.2': 'https://downloads.mariadb.org/interstitial/mariadb-11.5.2/winx64-packages/mariadb-11.5.2-winx64.zip',
      },
    },
  ],

  // ===================== 大数据 =====================
  bigdata: [
    {
      name: 'Hadoop',
      version: 'Hadoop 3.4.0',
      url: 'https://archive.apache.org/dist/hadoop/common/hadoop-3.4.0/hadoop-3.4.0.tar.gz',
      path: 'hadoop',
      check: 'hadoop',
      env: { name: 'HADOOP_HOME', bin: 'bin', markers: ['bin/hadoop.cmd', 'bin/hadoop.exe'] },
      versions: ['Hadoop 3.3.6', 'Hadoop 3.4.0'],
      downloads: {
        'Hadoop 3.3.6': 'https://archive.apache.org/dist/hadoop/common/hadoop-3.3.6/hadoop-3.3.6.tar.gz',
        'Hadoop 3.4.0': 'https://archive.apache.org/dist/hadoop/common/hadoop-3.4.0/hadoop-3.4.0.tar.gz',
      },
    },
    {
      name: 'Spark',
      version: 'Spark 3.5.3',
      url: 'https://archive.apache.org/dist/spark/spark-3.5.3/spark-3.5.3-bin-hadoop3.tgz',
      path: 'spark',
      check: 'spark-submit',
      env: { name: 'SPARK_HOME', bin: 'bin', markers: ['bin/spark-submit.cmd', 'bin/spark-submit2.cmd'] },
      versions: ['Spark 3.5.3'],
      downloads: {
        'Spark 3.5.3': 'https://archive.apache.org/dist/spark/spark-3.5.3/spark-3.5.3-bin-hadoop3.tgz',
      },
    },
    {
      name: 'Kafka',
      version: 'Kafka 3.8.1',
      url: 'https://archive.apache.org/dist/kafka/3.8.1/kafka_2.13-3.8.1.tgz',
      path: 'kafka',
      check: 'kafka-topics',
      env: { name: null, bin: 'bin', markers: ['bin/windows/kafka-topics.bat', 'bin/kafka-topics.bat'] },
      versions: ['Kafka 3.7.1', 'Kafka 3.8.1'],
      downloads: {
        'Kafka 3.7.1': 'https://archive.apache.org/dist/kafka/3.7.1/kafka_2.13-3.7.1.tgz',
        'Kafka 3.8.1': 'https://archive.apache.org/dist/kafka/3.8.1/kafka_2.13-3.8.1.tgz',
      },
    },
    {
      name: 'Flink',
      version: 'Flink 1.20.0',
      url: 'https://archive.apache.org/dist/flink/flink-1.20.0/bin/flink-1.20.0-bin-scala_2.12.tgz',
      path: 'flink',
      check: 'flink',
      env: { name: 'FLINK_HOME', bin: 'bin', markers: ['bin/flink.bat'] },
      versions: ['Flink 1.20.0'],
      downloads: {
        'Flink 1.20.0': 'https://archive.apache.org/dist/flink/flink-1.20.0/bin/flink-1.20.0-bin-scala_2.12.tgz',
      },
    },
    {
      name: 'Elasticsearch',
      version: 'Elasticsearch 8.15.3',
      url: 'https://artifacts.elastic.co/downloads/elasticsearch/elasticsearch-8.15.3-windows-x86_64.zip',
      path: 'elasticsearch',
      check: 'elasticsearch',
      env: { name: 'ELASTIC_HOME', bin: 'bin', markers: ['bin/elasticsearch.bat'] },
      versions: ['Elasticsearch 8.15.3'],
      downloads: {
        'Elasticsearch 8.15.3': 'https://artifacts.elastic.co/downloads/elasticsearch/elasticsearch-8.15.3-windows-x86_64.zip',
      },
    },
  ],

  // ===================== 容器与云原生 =====================
  container: [
    {
      name: 'Docker Desktop',
      version: 'Docker 4.34.0',
      url: 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe',
      path: 'docker',
      check: 'docker',
      env: { name: null, bin: null, markers: ['Docker Desktop.exe'] },
      versions: ['Docker 4.34.0'],
      downloads: {
        'Docker 4.34.0': 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe',
      },
    },
    {
      name: 'kubectl',
      version: 'kubectl 1.31.1',
      url: 'https://dl.k8s.io/release/v1.31.1/bin/windows/amd64/kubectl.exe',
      path: 'kubectl',
      check: 'kubectl',
      env: { name: null, bin: '', markers: ['kubectl.exe'] },
      versions: ['kubectl 1.30.4', 'kubectl 1.31.1'],
      downloads: {
        'kubectl 1.30.4': 'https://dl.k8s.io/release/v1.30.4/bin/windows/amd64/kubectl.exe',
        'kubectl 1.31.1': 'https://dl.k8s.io/release/v1.31.1/bin/windows/amd64/kubectl.exe',
      },
    },
    {
      name: 'Helm',
      version: 'Helm 3.16.2',
      url: 'https://get.helm.sh/helm-v3.16.2-windows-amd64.zip',
      path: 'helm',
      check: 'helm',
      env: { name: null, bin: '', markers: ['helm.exe'] },
      versions: ['Helm 3.16.2'],
      downloads: {
        'Helm 3.16.2': 'https://get.helm.sh/helm-v3.16.2-windows-amd64.zip',
      },
    },
    {
      name: 'Minikube',
      version: 'Minikube 1.34.0',
      url: 'https://github.com/kubernetes/minikube/releases/download/v1.34.0/minikube-windows-amd64.exe',
      path: 'minikube',
      check: 'minikube',
      env: { name: null, bin: '', markers: ['minikube.exe'] },
      versions: ['Minikube 1.34.0'],
      downloads: {
        'Minikube 1.34.0': 'https://github.com/kubernetes/minikube/releases/download/v1.34.0/minikube-windows-amd64.exe',
      },
    },
  ],

  // ===================== 中间件 =====================
  middleware: [
    {
      name: 'Nginx',
      version: 'Nginx 1.27.2',
      url: 'https://nginx.org/download/nginx-1.27.2.zip',
      path: 'nginx',
      check: 'nginx',
      env: { name: null, bin: '', markers: ['nginx.exe'] },
      versions: ['Nginx 1.26.2', 'Nginx 1.27.2'],
      downloads: {
        'Nginx 1.26.2': 'https://nginx.org/download/nginx-1.26.2.zip',
        'Nginx 1.27.2': 'https://nginx.org/download/nginx-1.27.2.zip',
      },
    },
    {
      name: 'RabbitMQ',
      version: 'RabbitMQ 3.13.7',
      url: 'https://github.com/rabbitmq/rabbitmq-server/releases/download/v3.13.7/rabbitmq-server-3.13.7.zip',
      path: 'rabbitmq',
      check: 'rabbitmqctl',
      env: { name: 'RABBITMQ_HOME', bin: 'sbin', markers: ['sbin/rabbitmqctl.bat', 'sbin/rabbitmqctl'] },
      versions: ['RabbitMQ 3.13.7'],
      downloads: {
        'RabbitMQ 3.13.7': 'https://github.com/rabbitmq/rabbitmq-server/releases/download/v3.13.7/rabbitmq-server-3.13.7.zip',
      },
    },
    {
      name: 'ZooKeeper',
      version: 'ZooKeeper 3.9.3',
      url: 'https://archive.apache.org/dist/zookeeper/zookeeper-3.9.3/apache-zookeeper-3.9.3-bin.tar.gz',
      path: 'zookeeper',
      check: 'zkServer',
      env: { name: 'ZOOKEEPER_HOME', bin: 'bin', markers: ['bin/zkServer.cmd'] },
      versions: ['ZooKeeper 3.9.3'],
      downloads: {
        'ZooKeeper 3.9.3': 'https://archive.apache.org/dist/zookeeper/zookeeper-3.9.3/apache-zookeeper-3.9.3-bin.tar.gz',
      },
    },
    {
      name: 'RocketMQ',
      version: 'RocketMQ 5.3.0',
      url: 'https://archive.apache.org/dist/rocketmq/5.3.0/rocketmq-all-5.3.0-bin-release.zip',
      path: 'rocketmq',
      check: 'mqbroker',
      env: { name: 'ROCKETMQ_HOME', bin: 'bin', markers: ['bin/mqbroker.exe', 'bin/mqbroker.cmd'] },
      versions: ['RocketMQ 5.3.0'],
      downloads: {
        'RocketMQ 5.3.0': 'https://archive.apache.org/dist/rocketmq/5.3.0/rocketmq-all-5.3.0-bin-release.zip',
      },
    },
  ],

  // ===================== 通用开发工具 =====================
  tools: [
    {
      name: 'Git',
      version: 'Git 2.47.0',
      url: 'https://github.com/git-for-windows/git/releases/download/v2.47.0.windows.2/Git-2.47.0.2-64-bit.exe',
      path: 'git',
      check: 'git',
      env: { name: null, bin: null, markers: ['cmd/git.exe', 'bin/git.exe', 'git.exe'] },
      versions: ['Git 2.47.0'],
      downloads: {
        'Git 2.47.0': 'https://github.com/git-for-windows/git/releases/download/v2.47.0.windows.2/Git-2.47.0.2-64-bit.exe',
      },
    },
    {
      name: 'CMake',
      version: 'CMake 3.31.0',
      url: 'https://github.com/Kitware/CMake/releases/download/v3.31.0/cmake-3.31.0-windows-x86_64.zip',
      path: 'cmake',
      check: 'cmake',
      env: { name: null, bin: 'bin', markers: ['bin/cmake.exe'] },
      versions: ['CMake 3.31.0'],
      downloads: {
        'CMake 3.31.0': 'https://github.com/Kitware/CMake/releases/download/v3.31.0/cmake-3.31.0-windows-x86_64.zip',
      },
    },
    {
      name: 'MinGW-w64',
      version: 'MinGW-w64 14.2.0',
      url: 'https://github.com/brechtsanders/winlibs_mingw/releases/download/14.2.0posix-19.1.1-12.0.0/winlibs-x86_64-posix-seh-gcc-14.2.0-llvm-19.1.1-mingw-w64ucrt-12.0.0-r1.zip',
      path: 'mingw',
      check: 'gcc',
      env: { name: 'MINGW_HOME', bin: 'bin', markers: ['bin/gcc.exe'] },
      versions: ['MinGW-w64 14.2.0'],
      downloads: {
        'MinGW-w64 14.2.0': 'https://github.com/brechtsanders/winlibs_mingw/releases/download/14.2.0posix-19.1.1-12.0.0/winlibs-x86_64-posix-seh-gcc-14.2.0-llvm-19.1.1-mingw-w64ucrt-12.0.0-r1.zip',
      },
    },
  ],
}

module.exports = { softwares }
