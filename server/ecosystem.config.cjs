module.exports = {
  apps: [
    {
      name: 'agent-api',
      cwd: __dirname,
      script: './src/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        AGENT_HOST: '127.0.0.1',
        AGENT_PORT: '3001',
        AGENT_ADMIN_USERNAME: 'admin',
        AGENT_ADMIN_PASSWORD: 'change-me-please',
        AGENT_AUTH_SECRET: 'replace-with-a-long-random-string',
        AGENT_AI_CONFIG_SOURCE: 'mysql',
        MYSQL_HOST: '',
        MYSQL_PORT: '3306',
        MYSQL_USER: '',
        MYSQL_PASSWORD: '',
        MYSQL_DATABASE: '',
        AI_SETTINGS_MYSQL_TABLE: 'ai_provider_configs',
        OPENAI_KEY_ENCRYPTION_SECRET: '',
        OPENAI_API_KEY: ''
      }
    }
  ]
}
