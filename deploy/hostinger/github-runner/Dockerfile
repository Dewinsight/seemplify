FROM ubuntu:24.04

ARG RUNNER_VERSION=2.336.0
ARG RUNNER_SHA256=04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      docker.io \
      docker-compose-v2 \
      git \
      git-lfs \
      gh \
      jq \
      libicu74 \
      libssl3 \
      openssh-client \
      rsync \
      sudo \
      tar \
      unzip \
      xz-utils \
      zip \
    && curl -fsSL -o /tmp/packages-microsoft-prod.deb \
      https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb \
    && dpkg -i /tmp/packages-microsoft-prod.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends powershell \
    && rm -rf /var/lib/apt/lists/* /tmp/packages-microsoft-prod.deb

RUN useradd --create-home --uid 1001 --shell /bin/bash runner \
    && printf 'runner ALL=(ALL) NOPASSWD:ALL\n' >/etc/sudoers.d/runner \
    && chmod 0440 /etc/sudoers.d/runner \
    && install -d -o runner -g runner /runner /opt/runner-hooks \
    && curl -fsSL -o /tmp/actions-runner.tar.gz \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
    && echo "${RUNNER_SHA256}  /tmp/actions-runner.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/actions-runner.tar.gz -C /runner \
    && /runner/bin/installdependencies.sh \
    && chown -R runner:runner /runner \
    && rm -f /tmp/actions-runner.tar.gz

COPY --chown=runner:runner entrypoint.sh /usr/local/bin/runner-entrypoint
COPY --chown=runner:runner cleanup-workspace.sh /opt/runner-hooks/cleanup-workspace.sh

RUN chmod 0755 /usr/local/bin/runner-entrypoint /opt/runner-hooks/cleanup-workspace.sh

ENV ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/runner-hooks/cleanup-workspace.sh
ENV RUNNER_WORKDIR=_work

WORKDIR /runner
USER runner
ENTRYPOINT ["/usr/local/bin/runner-entrypoint"]
