# ---- Build stage ----
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime stage ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

# Non-root user (Cloud Run best practice)
RUN groupadd -r nodeapp && useradd -r -g nodeapp nodeapp

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Cloud Run injects PORT at runtime; server.js already reads process.env.PORT
EXPOSE 8080
ENV PORT=8080

RUN chown -R nodeapp:nodeapp /app
USER nodeapp

CMD ["node", "src/server.js"]
