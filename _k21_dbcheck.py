import sqlite3, sys
c = sqlite3.connect('/tmp/fc_k21.db')
c.row_factory = sqlite3.Row
for r in c.execute('SELECT username, role FROM fc_users ORDER BY username').fetchall():
    print(dict(r))
