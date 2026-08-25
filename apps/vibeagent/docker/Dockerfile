FROM node:26-alpine

# The agent's only tool is bash, so it is part of the runtime contract rather
# than a convenience. git and coreutils make the shell usable for real work.
RUN apk add --no-cache bash git coreutils

WORKDIR /app
COPY --chown=node:node apps/vibeagent/dist ./dist

# Generated sessions live here. Declared so a run without the compose volume
# still has a writable path instead of failing on the first tool call.
RUN mkdir -p /workspace && chown -R node:node /workspace

ENV NODE_ENV=production PORT=18081 VIBE_WORKSPACE_ROOT=/workspace
USER node
EXPOSE 18081
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 18081) + '/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/index.js"]
