FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY indexer.js ./

CMD ["node", "indexer.js"]
