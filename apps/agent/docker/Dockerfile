FROM node:26-alpine

WORKDIR /app
COPY --chown=node:node apps/agent/dist ./dist

ENV NODE_ENV=production PORT=18081
USER node
EXPOSE 18081
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 18081) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/index.js"]
