FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

# Bundle app source
COPY --chown=node:node . .

# Fastify listens on port 3000 by default, Cloud Run provides PORT environment variable
ENV PORT=8080
EXPOSE 8080

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

# Command to run the application
CMD [ "npm", "start" ]
