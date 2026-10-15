# Herramientas de desarrollo de la app Electron y de OpenSpec, para no instalar
# Node en el host. No es una imagen de despliegue: se usa con bin/dev y bin/openspec
# (servicio `node` de compose.override.yaml).
#
# Node 22, como el job de release en CI. La imagen completa (no -slim) trae git,
# python3 y compiladores por si alguna dependencia nativa se compila en npm ci.
FROM node:22-bookworm

# Versión con la que se generaron las skills de .claude/ (metadata.generatedBy)
ARG OPENSPEC_VERSION=1.14.1
RUN npm install -g @fission-ai/openspec@${OPENSPEC_VERSION} \
    && npm cache clean --force
