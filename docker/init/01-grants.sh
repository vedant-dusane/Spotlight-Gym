#!/bin/sh
# Lets the app user create/use the separate TEST database (gym_classes_test) used by `npm test`.
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}%\`.* TO '${MYSQL_USER}'@'%'; FLUSH PRIVILEGES;"
