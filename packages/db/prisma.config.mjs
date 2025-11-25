export default {
  schema: './prisma/schema.prisma',
  datasource: {
    db: {
      provider: 'postgresql',
      url: { fromEnvVar: 'DATABASE_URL' },
    },
  },
};
