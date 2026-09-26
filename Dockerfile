FROM docker.io/library/caddy:2.10.2-alpine
COPY public/ /srv/
COPY deploy/Caddyfile /etc/caddy/Caddyfile
