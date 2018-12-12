#!/bin/sh
set -eu

API_UWSGI_CACHE_PATH="${PROJECT_PATH}/uwsgi_cache"
WWW_UWSGI_CACHE_KEY="\$uri?\$args?${PROJECT_REV}"

# Configure measurement protocol endpoint
GA_API_URL="http://google-analytics.com/collect?v=1&t=pageview&tid=${GA_KEY-}"
GA_API_URL="${GA_API_URL}&uip=\$remote_addr"  # IP address
GA_API_URL="${GA_API_URL}&dh=\$host"  # Host
GA_API_URL="${GA_API_URL}&dp=\$uri"  # Document path
GA_API_URL="${GA_API_URL}&ds=api"  # Data source
GA_API_URL="${GA_API_URL}&dt=API"  # Page title
GA_API_URL="${GA_API_URL}&cid=\$connection\$msec"  # Anonymous Client-ID, give a unique value
GA_API_URL="${GA_API_URL}&an=\$http_x_clic_client"  # Application name
[ -n "${GA_KEY-}" ] && GA_API_ACTION="post_action @forward_to_ga;" || GA_API_ACTION=""

# Make sure uWSGI cache is available for writing but empty
mkdir -p ${API_UWSGI_CACHE_PATH}
rm -r -- "${API_UWSGI_CACHE_PATH}"/* || true
chown www-data:www-data ${API_UWSGI_CACHE_PATH}

cat <<EOF > /etc/nginx/sites-available/${PROJECT_NAME}
# This file is automatically generated, do not alter
upstream uwsgi_server {
    server unix://${API_SOCKET};
}

# NB: inactive items get thrown away entirely, uwsgi_cache_background_update
# won't save us.
uwsgi_cache_path ${API_UWSGI_CACHE_PATH} levels=1:2 keys_zone=api_cache:8m inactive=2w max_size=${API_UWSGI_CACHE_SIZE};

server {
    listen      80;
    server_name ${WWW_SERVER_NAME};
    charset     utf-8;
    root "${PROJECT_PATH}/client/www";
    gzip        on;
    gzip_proxied any;
    gzip_types
        text/css
        text/javascript
        text/xml
        text/plain
        application/javascript
        application/x-javascript
        application/json;

    proxy_intercept_errors on;
    error_page 502 503 504 /error/bad_gateway.json;

    # Emergency CLiC disabling rewrite rule, uncomment to disable clic access
    # rewrite ^(.*) /error/maintenance.html;

    location @forward_to_ga {
        resolver 8.8.8.8 ipv6=off;
        internal;
        proxy_ignore_client_abort on;
        proxy_next_upstream timeout;
        valid_referers server_names;

        # If the referer is valid (i.e. triggered by CLiC client), don't log to GA
        if (\$invalid_referer = "") {
            return 204;
        }

        # Some nearly-working magic to escape \$url
        # https://stackoverflow.com/questions/28995818/nginx-proxy-pass-and-url-decoding
        # TODO: Any improvement?
        rewrite ^ \$request_uri break;
        proxy_pass ${GA_API_URL};
    }

    location = /robots.txt {
        return 200 'User-agent: *
Disallow: /api/
';
    }

    location /api/ {
        include uwsgi_params;
        uwsgi_pass  uwsgi_server;
        uwsgi_read_timeout ${WWW_UWSGI_TIMEOUT};

        # All API results are deterministic, cache them
        uwsgi_cache ${WWW_UWSGI_CACHE_ZONE};
        uwsgi_cache_key "${WWW_UWSGI_CACHE_KEY}";
        uwsgi_cache_valid 200 302;
        uwsgi_cache_methods GET HEAD;
        # Less thundering herd
        uwsgi_cache_lock on;
        uwsgi_cache_min_uses 3;
        # Allow serving of stale responses during update
        uwsgi_cache_use_stale updating;
        uwsgi_cache_background_update on;

        add_header X-Uwsgi-Cache-Key "${WWW_UWSGI_CACHE_KEY}";
        add_header X-Uwsgi-Cached "\$upstream_cache_status";
        add_header X-Uwsgi-Generated "\$upstream_http_x_generated";

        ${GA_API_ACTION}
    }

    location /local-docs {
        alias "${PROJECT_PATH}/docs/_build";
    }

    location /docs {
        rewrite /docs(/.*) ${WWW_RTD_BASE_URL}\$1  redirect;
    }

    # Versioned resources can be cached forever
    location ~ ^(.*)\.r\w+\$ {
        try_files \$1 =404;
        expires 30d;
        add_header Vary Accept-Encoding;
    }

    location / {
        # Downloads links
        rewrite ^/downloads/clic-1.4.zip https://github.com/birmingham-ccr/clic-legacy/archive/4370f90a753763c9c3cff50549fa3446ef650954.zip permanent;
        rewrite ^/downloads/DNOV.zip https://github.com/birmingham-ccr/clic-DNOV-xml/archive/ac4ab0ca857fc0c53899ad60af4d116252f89555.zip permanent;
        rewrite ^/downloads/19C.zip https://github.com/birmingham-ccr/clic-19C-xml/archive/afde3a8a21ce3689dd7dd4f1b6271eb2724c2783.zip permanent;
        rewrite ^/downloads/clic-annotation.zip https://github.com/birmingham-ccr/clic/tree/ddd9d08b8078186426fd2e253665a59e8d4a161a/annotation permanent;
        rewrite ^/downloads/clic-gold-standard.zip https://github.com/birmingham-ccr/clic-gold-standard/archive/df4ff05f18d03103cd0ad561c1ff105d49ed30c1.zip permanent;
        rewrite ^/downloads/?$ http://www.birmingham.ac.uk/schools/edacs/departments/englishlanguage/research/projects/clic/downloads.aspx;

        # No-longer-available pages got to the homepage
        rewrite ^/(publications|about|documentation|definitions|events)/?$ https://www.birmingham.ac.uk/schools/edacs/departments/englishlanguage/research/projects/clic/index.aspx;

        # Some aliases
        rewrite ^/subsets/$ /subsets permanent;
        rewrite ^/concordances/?$ /concordance permanent;

        # Allow copies of index.html to be cached for a short amount of time
        expires 1m;

        # We're a single-page-app, all URLs lead to index.html
        try_files \$uri \$uri.html /index.html;
    }
}
EOF
ln -fs /etc/nginx/sites-available/${PROJECT_NAME} /etc/nginx/sites-enabled/${PROJECT_NAME}
nginx -t
systemctl reload nginx.service
