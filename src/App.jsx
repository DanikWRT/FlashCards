import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import MySets from './pages/MySets.jsx'
import SetPage from './pages/SetPage.jsx'
import ImportPage from './pages/ImportPage.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<MySets />} />
          <Route path="/sets/new" element={<ImportPage />} />
          <Route path="/set/:id" element={<SetPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
