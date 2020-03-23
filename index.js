"use strict";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import tmp from "tmp";
import { exec } from "child_process";
import commander from "commander";

dotenv.config();

/**
 *  Requirements
 *  ~/.pgpass should be set up, so that pg_dump can be executed with just DB_USER and DB_NAME
 *  ~/.ssh/config should be set up, so that ssh and scp can be executed with just BACKUP_STORE
 *
 *  This script is meant to be run daily via some external cron mechanism
 */

const {
  GMAIL_USER,
  GMAIL_PASS,
  GMAIL_RECEPIENTS,
  DB_USER,
  DB_NAME,
  BACKUP_STORE
} = process.env;

const SECONDS_IN_DAY = 24 * 60 * 60;
const SECONDS_IN_WEEK = 7 * SECONDS_IN_DAY;
const SECONDS_IN_MONTH = 4 * SECONDS_IN_WEEK;
const SECONDS_IN_YEAR = 12 * SECONDS_IN_MONTH;

const transport = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS
  }
});

const program = new commander.Command("psql_backup");
program.version("0.0.1");

program
  .option("-l, --list", "List existing backups")
  .option("-b, --backup", "Make a backup")
  .option(
    "-r, --restore <backup_timestamp>",
    "Restore from a backup, specified with timestamp"
  );

program.parse(process.argv);

if (program.list) listBackups();
if (program.backup) makeBackup();
if (program.restore) restoreFromBackup(program.restore);

async function sendMail(msg) {
  const list = await prettyBackupList();
  await transport.sendMail({
    from: `"Hyposoft backup system" <${GMAIL_USER}>`,
    to: GMAIL_RECEPIENTS,
    subject: "Hyposoft backup system notification",
    text: `${msg}
    ${list}   
    `
  });
}

function execute(command) {
  return new Promise((resolve, reject) => {
    exec(command, function(error, stdout, stderr) {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function dumpBackup() {
  const tmpFile = tmp.fileSync();
  await execute(`pg_dump --user ${DB_USER} --db ${DB_NAME} > ${tmpFile.name}`);
  return tmpFile;
}

async function sendBackup(file) {
  return await execute(`
    ssh ${BACKUP_STORE} "(mkdir ~/.backups ; mkdir ~/.backups/daily ; mkdir ~/.backups/weekly ; mkdir ~/.backups/monthly) || echo 1" && \
    scp ${file.name} ${BACKUP_STORE}:~/.backups/daily/${Date.now()}
  `);
}

async function backupTimestamps() {
  function format(lsStr) {
    return lsStr
      .trim()
      .split(/\s/)
      .map(s => parseInt(s.trim()))
      .filter(ts => !isNaN(ts));
  }

  return Promise.all([
    await execute(`ssh ${BACKUP_STORE} "ls ~/.backups/daily"`).then(format),
    await execute(`ssh ${BACKUP_STORE} "ls ~/.backups/weekly"`).then(format),
    await execute(`ssh ${BACKUP_STORE} "ls ~/.backups/monthly"`).then(format)
  ]);
}

async function prettyBackupList() {
  const [daily, weekly, monthly] = await backupTimestamps();

  function prettify(lst) {
    return lst.map(ts => `${ts} (${new Date(ts).toUTCString()})`).join("\n");
  }

  return `Available backups:
Daily: 
${prettify(daily)}
Weekly: 
${prettify(weekly)}
Monthly: 
${prettify(monthly)}
  `;
}

async function cleanup() {
  const [daily, weekly, monthly] = await backupTimestamps();

  if (daily.length > 7) {
    const toMove = Math.max(...daily);
    await execute(
      `ssh ${BACKUP_STORE} "mv ~/.backups/daily/${toMove} ~/.backups/weekly/${toMove}"`
    );
    weekly.push(toMove);
  }

  if (weekly.length > 4) {
    const toMove = Math.max(...weekly);
    await execute(
      `ssh ${BACKUP_STORE} "mv ~/.backups/weekly/${toMove} ~/.backups/monthly/${toMove}"`
    );
    monthly.push(toMove);
  }

  if (monthly.length > 12) {
    const toRemove = Math.max(...monthly);
    await execute(`ssh ${BACKUP_STORE} "rm ~/.backups/monthly/${toRemove}"`);
  }
}

async function restore(ts) {
  const tmpFile = tmp.fileSync();
  const path = (
    await execute(`ssh ${BACKUP_STORE} "find ~/.backups" -name ${ts}`)
  ).trim();
  if (path.length === 0) {
    return `Backup with name ${ts} doesn't exist`;
  }

  await execute(`scp ${BACKUP_STORE}:${path} ${tmpFile.name}`);

  return await execute(
    `psql --user ${DB_USER} --db ${DB_NAME} -f ${tmpFile.name}`
  );
}

async function makeBackup() {
  try {
    const tmpFile = await dumpBackup();
    await sendBackup(tmpFile);
    await sendMail("Backup succeeded!");
  } catch (e) {
    await sendMail(`Backup failed with message\n${JSON.stringify(e, null, 2)}`);
  } finally {
    await cleanup();
  }
}

async function listBackups() {
  try {
    await prettyBackupList();
  } catch (e) {
    console.error(e);
  }
}

async function restoreFromBackup(ts) {
  try {
    await restore(ts);
    console.log("completed without errors!");
  } catch (e) {
    console.error(e);
  }
}
