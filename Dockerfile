# Proton All: Rclone + The Terminal Browser + The Local Web Ui, In One Image.
ARG RCLONE_VERSION=1.75.2
FROM rclone/rclone:${RCLONE_VERSION} AS rclone

FROM python:3.12-slim
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone

WORKDIR /app
COPY pdrive pdrive-web pdrive-selftest /usr/local/bin/
COPY webui /app/webui
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/pdrive /usr/local/bin/pdrive-web /usr/local/bin/pdrive-selftest /usr/local/bin/entrypoint.sh \
 && mkdir -p /config /data && chmod 777 /config /data

# The Container User Is Chosen At Run Time (PUID/PGID In Compose) So Files Land
# On The Host Owned By You; /config Is World-Writable For That Reason.
ENV HOME=/config \
    RCLONE_CONFIG=/config/rclone.conf \
    PDRIVE_RCLONE=/usr/local/bin/rclone \
    PDRIVE_WEBUI=/app/webui \
    PDRIVE_HOST=0.0.0.0 \
    PDRIVE_LOCAL=/data \
    PDRIVE_LOCAL_ROOT=/data

EXPOSE 8765
# Any HTTP Answer (Even 401/403 Without The Cookie) Proves The Server Is Alive.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python3", "-c", "import urllib.request as u, urllib.error as e\ntry:\n u.urlopen('http://127.0.0.1:8765/api/status', timeout=3)\nexcept e.HTTPError:\n pass"]
VOLUME ["/config"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["pdrive-web"]
