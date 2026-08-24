FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js customEvents.js googleTasks.js ./
COPY public ./public

EXPOSE 3000

CMD ["node", "server.js"]
