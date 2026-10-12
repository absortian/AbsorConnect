# Spec Delta

## ADDED Requirements

### Requirement: Entrada inmediata y sin pérdidas
La terminal SHALL enviar cada pulsación al servidor en cuanto se produce, sin esperar a agruparla con las siguientes, de modo que el eco tarde lo que tarda la red. Todo lo que se escribe o se pega MUST llegar al servidor completo y en el mismo orden, también cuando se envían muchos comandos seguidos o se escribe mientras la sesión se abre o se reconecta.

#### Scenario: Tecleo rápido
- **WHEN** alguien teclea rápido en una terminal abierta
- **THEN** cada carácter aparece tras el tiempo de ida y vuelta de la red, sin esperas añadidas por la app

#### Scenario: Muchos comandos seguidos
- **WHEN** alguien envía muchos comandos seguidos pulsando Enter, o los pega de una vez
- **THEN** el servidor recibe y ejecuta todos, en el orden en que se escribieron

#### Scenario: Escribir mientras se conecta
- **WHEN** alguien escribe mientras la terminal se abre o se reconecta
- **THEN** lo escrito se envía en orden en cuanto la sesión está abierta

#### Scenario: Sesión terminada
- **WHEN** alguien escribe en una terminal cuya sesión terminó y no ha pedido reconectar
- **THEN** lo escrito no se envía más tarde, para no ejecutar órdenes antiguas al reconectar
