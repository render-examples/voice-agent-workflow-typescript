FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY agent/package.json agent/tsconfig.json ./
RUN npm install

COPY agent/src ./src
RUN npm run build

CMD ["npm", "start"]

