FROM node:26-slim

# Debian rather than Alpine.
#
# The agent's capability comes from skills, and skills bring their own runtimes.
# Alpine is musl, and the browsers Playwright ships — along with a good deal of
# the Python wheel ecosystem — are built against glibc. On Alpine every one of
# those has to be replaced by a distribution package and then pointed at by hand,
# which is a stream of small breakages a skill author cannot see coming. The
# larger base buys the property that a skill written elsewhere runs here.

# --- system tools -----------------------------------------------------------
#
# bash is part of the runtime contract: it is the agent's only built-in tool.
# The rest is what published skills reach for — document, image and media
# conversion, PDF handling, OCR — plus the shared libraries a headless Chromium
# needs.
#
# LibreOffice is here as its three component packages rather than the umbrella
# one, and with recommends off: the umbrella pulls a desktop this container has
# no screen for. It is the largest single thing in the image and it is here
# because converting Office formats to PDF is what the document skills are for,
# and nothing else in Debian does it.
#
# One layer, before anything that changes per build, so a code change never
# re-downloads any of it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash git ca-certificates curl unzip \
      python3 python3-pip python3-venv python-is-python3 \
      poppler-utils qpdf \
      imagemagick ghostscript \
      pandoc \
      ffmpeg \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-kor \
      libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-liberation fonts-dejavu-core fonts-noto-cjk \
      libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
      libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# --- Python libraries -------------------------------------------------------
#
# Installed globally rather than per skill. A skill's folder is read-only and
# the project is not the place for a virtualenv, so there is nowhere for a skill
# to install anything at the moment it needs it — which would also mean a
# network call in the middle of a task.
#
# PEP 668 marks the system Python as externally managed; this image *is* the
# environment, so the flag states what is already true rather than working
# around a protection.
COPY apps/vibeagent/docker/requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

# --- the headless browser ---------------------------------------------------
#
# Under /opt rather than in a home directory, because four different containers
# run from this image and the browser belongs to the image, not to whoever the
# process happens to be. `PLAYWRIGHT_BROWSERS_PATH` has to be set at build time
# *and* kept in the environment, or the runtime looks somewhere else and reports
# a browser that is plainly present as missing.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN python3 -m playwright install chromium \
    && chmod -R a+rX /opt/playwright

WORKDIR /app
COPY --chown=node:node apps/vibeagent/dist ./dist

# Generated sessions live here. Declared so a run without the compose volume
# still has a writable path instead of failing on the first tool call.
RUN mkdir -p /workspace && chown -R node:node /workspace

# `HOME` is set because LibreOffice, Jupyter and matplotlib all want somewhere to
# write a profile, and a process with no home writes to `/` and fails there.
# `MPLBACKEND` keeps matplotlib from looking for a display it will not find; a
# plot in this container is a file, never a window.
ENV NODE_ENV=production PORT=18081 VIBE_WORKSPACE_ROOT=/workspace \
    HOME=/home/node \
    PYTHONDONTWRITEBYTECODE=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MPLBACKEND=Agg \
    JUPYTER_PLATFORM_DIRS=1
RUN mkdir -p /home/node/.cache /home/node/.config /home/node/.local \
    && chown -R node:node /home/node

USER node
EXPOSE 18081
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 18081) + '/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/index.js"]
