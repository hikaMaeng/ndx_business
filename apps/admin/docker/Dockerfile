# Runtime-only image. The project is built on the host; this copies the result.
# Never add a build step here - see the docker-compose-module-design skill.
FROM node:26-alpine

WORKDIR /app

# dist is a self-contained bundle, so the image's Node major is the runtime
# contract on its own and owes nothing to the host toolchain version.
COPY --chown=node:node apps/admin/dist ./dist

RUN mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production
ENV PORT=18080

# The base image ships an unprivileged `node` user. Use it: nothing here needs
# root, and a compromised process should not own the filesystem.
USER node

EXPOSE 18080

# Self-reported health, so `docker compose ps` and depends_on conditions mean
# something. Uses global fetch rather than adding curl to the image.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/index.js"]
