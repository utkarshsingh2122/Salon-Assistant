# simple node image
FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production=false || npm install
COPY src ./src
CMD ["node","src/server.js"]
