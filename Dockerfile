FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production
RUN useradd --system --uid 1001 lifeos && mkdir -p /data/uploads && chown lifeos /data/uploads
COPY --from=build /app ./
USER lifeos
EXPOSE 3000
CMD ["npm", "run", "start"]
