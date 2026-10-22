# Build the Vue client
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# Runtime image: server plus the built client. Cards and saved games are mounted, not baked in.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    CARDS_DIR=/app/cards
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
# data/ must exist and be writable by the unprivileged user so a named volume inherits its ownership
RUN mkdir -p /app/data /app/cards && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
