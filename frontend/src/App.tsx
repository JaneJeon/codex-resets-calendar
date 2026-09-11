import { calendarPaths, calendarServiceName } from '@janejeon/calendars-shared'

export default function App() {
  return (
    <main>
      <p>Jane Jeon</p>
      <h1>{calendarServiceName}</h1>
      <p>Subscribe to a calendar feed:</p>
      <ul>
        <li>
          <a href={calendarPaths.codexResets}>{calendarPaths.codexResets}</a>
        </li>
        <li>
          <a href={calendarPaths.dtsmEvents}>{calendarPaths.dtsmEvents}</a>
        </li>
      </ul>
    </main>
  )
}
