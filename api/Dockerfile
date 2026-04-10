FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY api/package.json api/tsconfig.json ./
RUN npm install

COPY api/src ./src
RUN npm run build

EXPOSE 8000
CMD ["npm", "start"]

