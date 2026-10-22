FROM dewinsight/crm-actions-runner:2.336.0
USER root
RUN ln -sf /runner/externals/node20/bin/node /usr/local/bin/node \
    && mkdir -p /opt/hostedtoolcache /root/.npm
ENV RUNNER_TOOL_CACHE=/opt/hostedtoolcache
# Hostinger lanes use the bundled CPU runtime; optional CUDA assets are unused.
ENV ONNXRUNTIME_NODE_INSTALL=skip ONNXRUNTIME_NODE_INSTALL_CUDA=skip
ENTRYPOINT []
