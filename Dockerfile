FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787

COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY README.md ./README.md

EXPOSE 8787
CMD ["node", "src/server.js"]
