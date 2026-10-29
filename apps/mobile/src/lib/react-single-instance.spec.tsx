import { render } from '@testing-library/react'
import { useState } from 'react'
import { expect, it } from 'vitest'

it('react-dom renders hooks from the same React module the app imports', () => {
  function Probe() {
    // With a second React copy, this hook reads the other copy's empty dispatcher.
    const [value] = useState('one-react')
    return <p>{value}</p>
  }
  // Testing Library renders through react-dom, so the hook runs on react-dom's React.
  const view = render(<Probe />)
  expect(view.container).toHaveTextContent('one-react')
})
