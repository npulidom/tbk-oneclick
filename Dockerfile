# ! base stage
FROM node:20-alpine AS base

# allow "node" user to open port 80
RUN apk add libcap && setcap 'cap_net_bind_service=+ep' /usr/local/bin/node

# app directory
WORKDIR /home/node/app

# copy node packages
COPY package.json .

# package lock file
RUN npm i --package-lock-only

# build id argument
ARG BUILD_ID
ENV BUILD_ID=$BUILD_ID

# ! production stage
FROM base AS prod

ENV NODE_ENV=production

# install deps
RUN npm ci --omit=dev && npm cache clean --force

# copy app
COPY . .

# switch user
USER node

# cmd
CMD ["node", "init.js"]

# ! development stage
FROM base AS dev

ENV NODE_ENV=development

# install deps
RUN npm ci --omit=dev && npm cache clean --force

# copy app
COPY . .

# switch user
USER node

# cmd
CMD ["node", "--watch", "init.js"]
