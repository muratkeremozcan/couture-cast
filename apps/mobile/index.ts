// Story 6.15 P0-07: the bundle entry. A headless background wake (WorkManager after a reboot,
// a forced JobScheduler run) evaluates the bundle without rendering any route, so a module that
// only app/_layout.tsx imports is never evaluated there. expo-task-manager queues the task event
// until its JS listener exists and runs only tasks defined by then, so the ritual task is defined
// here, at bundle evaluation, for the headless run and the app alike.
import 'expo-router/entry'
import './src/lib/background-task'
