FROM node:boron

MAINTAINER Reekoh

RUN apt-get update && apt-get install -y build-essential

RUN mkdir -p /home/node/chikka-gateway
COPY . /home/node/chikka-gateway

WORKDIR /home/node/chikka-gateway

# Install dependencies
RUN npm install pm2 yarn -g
RUN yarn install

EXPOSE 8080
CMD ["pm2-docker", "--json", "app.yml"]