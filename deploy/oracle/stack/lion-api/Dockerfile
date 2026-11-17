# API de Lion Platform. El .jar lo compila el PC (el repo es privado) y viene en el paquete.
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
