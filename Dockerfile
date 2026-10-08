# Multi-stage: o estágio final não tem compilador, devDependencies nem código-fonte TS.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS run
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Usuário sem privilégio: se alguém explorar a app, não é root no container.
USER node
EXPOSE 3000
# `node` direto (não `npm start`): npm não repassa SIGTERM para o processo filho => shutdown gracioso quebra.
CMD ["node", "dist/server.js"]
