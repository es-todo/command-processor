FROM ubuntu:24.04
RUN apt update -y
RUN apt upgrade -y
RUN apt install wget -y
RUN apt install sudo -y
RUN apt install neovim -y
RUN wget https://deb.nodesource.com/setup_23.x
RUN sudo -E bash setup_23.x
RUN sudo apt-get install nodejs -y

RUN mkdir /app
WORKDIR /app

COPY ./package.json /app
COPY ./package-lock.json /app
RUN npm ci
COPY ./tsconfig.json /app
COPY ./src /app/src
RUN npm run check

COPY docker-entrypoint.sh /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
