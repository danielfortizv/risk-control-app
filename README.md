# Risk Control App

Aplicación web en React + Vite para registrar ciclos, controlar capital, calcular riesgo y analizar probabilidades ajustadas con datos reales.

> Nota: esta app no recomienda apostar. El valor recomendado para apostar se mantiene en $0. Solo calcula límites hipotéticos y métricas de riesgo para control y simulación.

## Funciones

- Registro de ciclos: fecha, apuesta base, resultado y nota.
- Cálculo automático de ganancia o pérdida neta según:
  - intento 1: apuesta base
  - intento 2: doble
  - intento 3: cuádruple
  - pérdida total: pierde los 3 intentos
- Ajuste de probabilidades con datos reales usando una estimación bayesiana Beta.
- Registro de capital actual.
- Registro de depósitos y retiros.
- Recomendación conservadora de retiro: porcentaje editable de ganancias netas.
- Meta editable y fecha objetivo.
- Exportar e importar respaldo JSON.
- Gráfica de evolución del capital.

## Instalación local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Despliegue en GitHub Pages

1. Crea un repositorio en GitHub.
2. Sube todos los archivos de este proyecto.
3. En GitHub, entra a **Settings > Pages**.
4. En **Build and deployment**, selecciona **GitHub Actions**.
5. Haz push a la rama `main`.
6. El workflow incluido en `.github/workflows/deploy.yml` publicará la app.

## Datos

Los datos se guardan en `localStorage`, dentro del navegador. Para no perderlos, usa el botón **Exportar** regularmente.
