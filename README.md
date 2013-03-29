KeepInTouch
===========

A Google Apps Engine script which sends you reminders to keep in touch with certain people.  Backs off exponentially and provides a link to the last conversation.  Just add Gmail contacts to a "Keep In Touch" group and run the onInstall() method.

Known Issues
------------

1. State is stored visibly on each contact as a KeepInTouch custom field (to make debugging easy).  It should be stored in the script properties of ScriptDb.
2. Links to the last conversation don't work correctly in the Android Gmail app.  (They work on the Gmail webpage.)
