type GreetingProps = {
  name?: string
}

export function Greeting({ name = 'world' }: GreetingProps) {
  return <h1>Hello, {name}!</h1>
}
