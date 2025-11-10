# Используем официальный образ Node.js 18 (LTS)
FROM node:18-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production

# Копируем все файлы проекта
COPY . .

# Открываем порт
EXPOSE 3030

# Запускаем приложение
CMD ["node", "server.js"]