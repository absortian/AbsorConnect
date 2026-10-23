# Concurrencia del backend del agente

Con el backend de desarrollo en marcha:

```bash
python3 prototypes/backend-agent-check/run.py
```

Solo usa la API local fija `http://127.0.0.1:8020`. Crea una cuenta efímera,
contraseña y claves aleatorias que no imprime; retira la cuenta al terminar.
El informe contiene únicamente estados y resultados. No lee cuentas existentes,
no contacta con producción y no instala agentes.

Ensaya tres canjes dobles concurrentes (un 201 y un 400), el canje frente al
registro legado (un solo propietario) y el canje frente al logout de origen
(ninguna credencial sobrevive). Comprueba la revocación por la API. Son peticiones
HTTP paralelas reales; no sustituyen las pruebas de revocación a 30 segundos del
trabajador nativo ni la matriz completa de plataformas.
