/* Configuration */
var config = {
  
  /* How long after the last contact to start reminding, in days. */
  'reminderInterval' : 90,
  
  /* How much to increase the interval on subsequent reminders. */
  'reminderBackoff'  : 1.3,
  
  /* The Google group to track and the name of the custom field
   * used to store the application state. */
  'group' : "Keep in touch"
};

/* Initial setup upon installation. This will install trigger to
 * periodically look for contact with individuals and email reminders. */
function onInstall() {
  
  deleteAllTriggers();
  
  /* Searching Gmail for each contact takes a long time (~2 min for
   * 30 contacts) so we won't do this more than once per day. */
  daily("updateLastContact");
  
  /* Sending reminders is pretty light-weight and we want to send
   * reminders within the same hour as the last contact, so we run
   * reminders hourly. */
  hourly("sendReminders");
}

/* Delete all triggers associated with this script. */
function deleteAllTriggers() {
  
  Logger.log("Deleting all triggers");
  var triggers = ScriptApp.getScriptTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
}

/* Run the given method once per hour. */
function hourly(method) {
  
  Logger.log("Running " + method + " hourly");
  ScriptApp.newTrigger(method)
  .timeBased()
  .everyHours(1)
  .create();
}

/* Run the given method once per day. */
function daily(method) {
 
  Logger.log("Running " + method + " daily");
  ScriptApp.newTrigger(method)
  .timeBased()
  .everyDays(1)
  .create();
}

/* Update all contacts with the time of last contact and
 * set the next reminder time. Reminders are sent by the
 * sendReminders method. This method is resource intensive 
 * and shouldn't be run more than once daily. */
function updateLastContact() {
  
  forEachContact(function(contact) {
    
    var name = contact.getFullName();
    var email = contact.getPrimaryEmail()
    Logger.log("Updating last contact for " + name + " " + email);
    
    /* Read the application state for this contact */
    var state = getContactState(contact);
    
    /* Find most recent conversation */
    var r = getLastContact(contact);
    
    /* If there is a more recent conversation, update state */
    if (r > state.lastContact) {
      Logger.log("More recent conversation found: " + new Date(r));
      state.nextReminder = computeReminderTime(r, state.timesReminded);
      state.lastContact = r;
      state.dirty = true;
    }

    setContactState(contact, state);
  });
}

/* Send reminders for any contacts which are overdue. The next
 * reminder state will be set by the updateLastContacted method. */
function sendReminders() {
  
  forEachContact(function(contact) {
    
    var name = contact.getFullName();
    var email = contact.getPrimaryEmail()
    Logger.log("Processing " + name + " " + email);
    
    /* Read the application state for this contact */
    var state = getContactState(contact);
    
    /* Are we due for a reminder? */
    var now = new Date().getTime();
    if (now > state.nextReminder) {
      
      Logger.log("We are due for a reminder");
      /* We save state first, so if there is a problem, we don't
       * send multiple emails, which would be annoying. We would
       * rather fail to remind than remind too much. */
      state.timesReminded = state.timesReminded + 1;
      emailReminder(contact);
      state.nextReminder = computeReminderTime(state.lastContact, state.timesReminded);
      Logger.log("Next reminder time: " + new Date(state.nextReminder));
      state.dirty = true;
    }
    
    setContactState(contact, state);
  });
}

/* Return the time of last contact with the given contact or 
 * null if no contact is found. */
function getLastContact(contact) {
  var lastThread = getLastThread(contact);
  if (lastThread) {
    return lastThread.getLastMessageDate().getTime();
  }
  return;
}

/* Return the last thread with the given contact or null if
 * no thread is found. */
function getLastThread(contact) {

  var emails = contact.getEmails();
  var lastContact = 0;
  var lastThread;
  
  /* We look for threads with any email address for this contact. */
  for (var i = 0; i < emails.length; i++) {
    var email = emails[i].getAddress();
    
    if (!email) {
      Logger.log("No email address. No point in searching.");
      continue;
    }
    
    var thread = search(email);
    if (thread) {
      var time = thread.getLastMessageDate().getTime();
      Logger.log("Last contact with " + email + " was on " + new Date(time));
      if (time > lastContact) {
        lastContact = time;
        lastThread = thread;
      }
    }
  }
  
  if (lastContact == 0) {
    Logger.log("No contact found with " + contact.getFullName());
    return;
  }
  Logger.log("Last contact with " + contact.getFullName() + " was " + new Date(lastContact));
  return lastThread;
}

/* Search for the last thread with the given email address. */
function search(email) {
  
  Logger.log("Searching for last contact with " + email);
  var query = "from:(" + email + ") OR to:(" + email +  ")";
  /* Paginated search starting at 0 with max results of 1. */
  var threads = GmailApp.search(query, 0, 1);
  
  if (threads.length > 0) {
    Logger.log("Found thread with " + email);
    return threads[0];
  }
}

/* Get the current state for this contact. This includes the time of
 * last contact, next reminder time and number of reminders sent 
 * since the last contact. */
function getContactState(contact) {
  
  var field = getContactField(contact);
  var state = { 'dirty' : true };
  
  /* Try and read the contact's custom field */
  try {
    var value = field.getValue();
    Logger.log("Read value: " + value + " from field");
    state = Utilities.jsonParse(value);
    state.dirty = false;
  } catch(e) { 
    /* Do nothing. Sometimes the field doesn't exist of has invalid data. */ 
    Logger.log("Non-existent field or unparsable state. Using defaults.");
  }
  
  /* Provide some defaults */
  if (state == null) {
    state = { 'dirty' : true };
  }
  if (state['lastContact'] == null) {
    state.lastContact = getLastContact(contact) || 0 /* Jan 1, 1970 */;
    state.dirty = true;
  }
  if (state['timesReminded'] == null) {
    state.timesReminded = 0;
    state.dirty = true;
  }
  if (state['nextReminder'] == null) {
    state.nextReminder = state['nextReminder'] || computeFirstReminderTime();
    state.dirty = true;
  }
  
  Logger.log("Returning state: " + Utilities.jsonStringify(state));
  return state;
}

/* Save the application state for this contact. */
function setContactState(contact, state) {
  
  /* This must the be last action on a contact. Subsequent changes
   * to a contact after saving state will result in a ref error
   * when saving. You can get around this by loading the contact 
   * again by id, but that takes a LONG time. */
  
  /* Don't update state unless it's changed. This is save on calls
   * to the ContactApps because this script was exhausting the user
   * quote with 24*30 calls per day. */
  if (state.dirty == false) {
    Logger.log("State is not dirty. Nothing to do.");
    return;
  }
  
  delete state.dirty;
  
  var stateString = Utilities.jsonStringify(state);
  Logger.log("Setting state: " + stateString);
  var field = getContactField(contact);
  
  if (!field) {
    Logger.log("Creating custom field '" + config.group + "'");
    contact.addCustomField(config.group, stateString);
    return;
  }
  
  field.setValue(stateString);
}

/* Get the field storing application state for this contact. */
function getContactField(contact) {
  
  var customFields = contact.getCustomFields();
  for (var i = 0; i < customFields.length; i++) {
    if (customFields[i].getLabel() == config.group) {
      Logger.log("Returning existing custom field '" + config.group + "'");
      return customFields[i];
    }
  }
  
  Logger.log("No custom field '" + config.group + "'.");
  /* Return null */
}

/* Compute the next reminder time given a last contact time and
 * the number of times reminded. */
function computeReminderTime(lastContact, i) {
  
  Logger.log("Computing reminder time from lastContact: " + new Date(lastContact) + " i: " + i);
  var now = new Date().getTime();
  var interval = config.reminderInterval;
  var backoff = config.reminderBackoff;
  
  /* The reminder time is at the next interval, which increases
   * exponentially, with a small shuffle factor of 10%. */
  var offset = interval * 24 * 60 * 60 * 1000 * Math.pow(backoff, i);
  var shuffle = interval/10 * 24 * 60 * 60 * 1000 * Math.pow(backoff, i) * Math.random();
  
  /* We send reminders in the same hour as the last contact. Why? So
   * you don't get emails at all hours of the night. */
  var time = sameHourAs(now + offset - shuffle, lastContact);
  Logger.log("Calculated offset: " + offset + " shuffle: " + shuffle + " => time: " + new Date(time));
  
  return time
}

/* Compute a reasonable first reminder when we first start tracking
 * a contact. We don't want to send a flood of reminders right off
 * the bat, so we choose a random time in the next 30 days. But we
 * also ensure we don't send a reminder before 30 has passed since
 * the last contact. */
function computeFirstReminderTime(lastContact) {
 
  Logger.log("Computing a first reminder time");
  var interval = config.reminderInterval * 24 * 60 * 60 * 1000;
  var now = new Date().getTime();
  
  /* How long to wait before 30 days has passed (if any.) */
  var delay = lastContact && (now - lastContact < interval) ? (now - lastContact) : 0;
  
  /* Choose an random time between delay and interval after now. */
  var offset = (interval - delay) * Math.random();
  var time = now + delay + offset;
  
  /* Send reminders in the same hour as the last contact. */
  if (lastContact) {
    time = sameHourAs(time, lastContact);
  }
  
  Logger.log("Randomly chose time: " + new Date(time));
  return time;
}

/* Round time a to the same hour as b. */
function sameHourAs(a, b) {
  
  Logger.log("Rounding a: " + new Date(a) + " to the same hour as b: " + new Date(b));
  var dateA = new Date(a);
  var dateB = new Date(b)
  dateA.setHours(dateB.getHours());
  dateA.setMinutes(dateB.getMinutes());
  dateA.setSeconds(dateB.getSeconds());
  var time = dateA.getTime();
  Logger.log("Rounded to time: " + new Date(time));
  
  return time;
}

/* Replace keys of params with their respective values. Keys are 
 * placed in the template between curly braces (i.e. "{key}") */
function replace(template, params) {

  var result = template;
  for (var key in params) {
    result = result.replace("{" + key + "}", params[key]);
  }
  return result;
}

/* How many days ago was the given time? */
function daysAgo(time) {
  
  var now = new Date().getTime();
  var daysAgo = parseInt((now - time) / (24 * 60 * 60 * 1000));
  return daysAgo;
}

/* Send a reminder about the given contact. */
function emailReminder(contact) {
  
  Logger.log("Emailing a reminder about contact: " + contact.getFullName());
  var thread = getLastThread(contact);
  
  /* Reminder email template */
  var message = "You haven't talked to {name} in a while{left}{a_begin}{last_contact}{a_end}{right}.";
  var params = {
    'name'         : contact.getFullName(),
    'left'         : thread ? " (" + daysAgo(thread.getLastMessageDate().getTime()) + " days : " : "",
    'a_begin'      : thread ? "<a href=\"https://mail.google.com/mail/u/0/?tab=om#inbox/" + thread.getId() + "\">" : "",
    'last_contact' : thread ? thread.getFirstMessageSubject() : "",
    'a_end'        : thread ? "</a>" : "",
    'right'        : thread ? ")" : ""
  };
  
  /* HTML version */
  var html = replace(message, params);
  
  /* Plain text version */
  params.a_begin = "";
  params.a_end = "";
  var plain = replace(message, params);
  
  Logger.log("Plain message: " + plain);
  Logger.log("HTML message: " + html);
  
  /* Send the message */
  var email = Session.getEffectiveUser().getEmail();
  Logger.log("Sending to: " + email);
  GmailApp.sendEmail(email, contact.getFullName(), plain, {
    'htmlBody' : html
  });
}

/* Apply function fn to each contact we're tracking. */
function forEachContact(fn) {
  
  var contacts = ContactsApp.getContactGroup(config.group).getContacts();
  for (i = 0; i < contacts.length; i++) {
    if (fn) fn(contacts[i]);
  }
}



// TESTING

function resetAllContactState() {
  
  forEachContact(function (contact) {
    Logger.log("Resetting state for contact: " + contact.getFullName());
    setContactState(contact, { 'dirty' : true });
  });
}

function logNextReminder() {
 
  var msg = "";
  
  forEachContact(function (contact) {
    var state = getContactState(contact);
    msg += contact.getFullName() + ": " + new Date(state.nextReminder) + "\n";
  });
  
  Logger.log(msg);
}


function testEmailReminder() {
  var contacts = ContactsApp.getContactGroup(config.group).getContacts();
  if (contacts.length > 0) {
    emailReminder(contacts[0]);
  }
}

function testComputeFirstReminderTime() {
 
  var now = new Date().getTime();
  var one = 35 * 24 * 60 * 60 * 1000;
  computeFirstReminderTime(now - one);
  var two = 25 * 24 * 60 * 60 * 1000;
  computeFirstReminderTime(now - two);
  computeFirstReminderTime(now);
}
