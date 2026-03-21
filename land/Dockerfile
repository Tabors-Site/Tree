FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

# Create directory for soil keypair
RUN mkdir -p .land

EXPOSE 80

CMD ["node", "server.js"]
