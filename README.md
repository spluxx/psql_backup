# Hyposoft psql_backup

## How to setup

* Run `npm install` (use the latest `node` version or at least something that supports esm module loader, like `v13.7.0`)

* Create an `.env` file that looks like the following
```bash
GMAIL_USER=hyposoft.db@gmail.com
GMAIL_PASS=password1234
GMAIL_RECEPIENTS=admin1@example.com,admin2@gmail.com
DB_USER=postgres
DB_NAME=hyposoft
BACKUP_STORE=backup_store
```

* Make sure your `~/.ssh/config` has the entry for `BACKUP_STORE` specified above.

```
Host backup_store
  HostName example.com
  User user
```

* Make sure you have the right credentials for the database or specify it on `~/.pgpass`.

```
localhost:5432:DB_NAME:DB_USER:DB_PASS:
```

* Make sure your gmail settings allow for Less secure app access.

* Run `node index.js --help` to see the possible commands.