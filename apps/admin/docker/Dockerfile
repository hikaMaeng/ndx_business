# Runtime-only Admin control-plane image. PostgreSQL, pgvector, and PGMQ are
# image-owned runtime dependencies; the application bundle is built on host.
FROM node:26-bookworm-slim AS node-runtime
FROM pgvector/pgvector:pg18

WORKDIR /app
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --chown=postgres:postgres apps/admin/dist ./dist
COPY apps/admin/docker/postgres/initdb/001-extensions.sql /docker-entrypoint-initdb.d/001-extensions.sql
COPY apps/admin/docker/admin-entrypoint.sh /usr/local/bin/admin-entrypoint.sh

RUN apt-get update \
    && apt-get install -y --no-install-recommends libatomic1 \
    && rm -rf /var/lib/apt/lists/* \
    && chmod 0755 /usr/local/bin/admin-entrypoint.sh \
    && mkdir -p /app/data \
    && chown -R postgres:postgres /app

ENV NODE_ENV=production \
    PORT=18080 \
    POSTGRES_DB=ndx_business \
    POSTGRES_USER=postgres \
    POSTGRES_PASSWORD=postgres \
    PGDATA=/var/lib/postgresql/data

USER postgres
EXPOSE 18080
EXPOSE 5432

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD bash -c "pg_isready -h 127.0.0.1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" && node -e \"fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""

CMD ["/usr/local/bin/admin-entrypoint.sh"]
